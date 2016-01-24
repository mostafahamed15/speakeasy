'use strict';

var base32 = require('base32.js');
var crypto = require('crypto');
var url = require('url');
var util = require('util');

/**
 * Digest the one-time passcode options.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {Integer} options.counter Counter value
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
 *   Shared secret key
 * @return {Buffer} The one-time passcode as a buffer.
 */

exports.digest = function digest (options) {
  var i;

  // unpack options
  var key = options.secret;
  var counter = options.counter;
  var encoding = options.encoding || 'ascii';
  var algorithm = (options.algorithm || 'sha1').toLowerCase();

  // Backwards compatibility - deprecated
  if (options.key) {
    console.log('Speakeasy - Deprecation Notice - Specifying the secret using `key` is no longer supported. Use `secret` instead.');
    key = options.key;
  }

  // convert key to buffer
  if (!Buffer.isBuffer(key)) {
    key = encoding === 'base32' ? base32.decode(key)
      : new Buffer(key, encoding);
  }

  // create an buffer from the counter
  var buf = new Buffer(8);
  var tmp = counter;
  for (i = 0; i < 8; i++) {
    // mask 0xff over number to get last 8
    buf[7 - i] = tmp & 0xff;

    // shift 8 and get ready to loop over the next batch of 8
    tmp = tmp >> 8;
  }

  // init hmac with the key
  var hmac = crypto.createHmac(algorithm, key);

  // update hmac with the counter
  hmac.update(buf);

  // return the digest
  return hmac.digest();
};

/**
 * Generate a counter-based one-time token.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {Integer} options.counter Counter value
 * @param {Buffer} [options.digest] Digest, automatically generated by default
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
 *   Shared secret key
 * @param {Integer} [options.length=6] (DEPRECATED. Use `digits` instead.) The
 *   number of digits for the one-time passcode.
 * @return {String} The one-time passcode.
 */

exports.hotp = function hotpGenerate (options) {
  // unpack digits
  // backward compatibility: `length` is also accepted here, but deprecated
  var digits = (options.digits != null ? options.digits : options.length) || 6;
  if (options.length) console.log('Speakeasy - Deprecation Notice - Specifying token digits using `length` is no longer supported. Use `digits` instead.');

  // digest the options
  var digest = options.digest || exports.digest(options);

  // compute HOTP offset
  var offset = digest[digest.length - 1] & 0xf;

  // calculate binary code (RFC4226 5.4)
  var code = (digest[offset] & 0x7f) << 24 |
    (digest[offset + 1] & 0xff) << 16 |
    (digest[offset + 2] & 0xff) << 8 |
    (digest[offset + 3] & 0xff);

  // left-pad code
  code = new Array(digits + 1).join('0') + code.toString(10);

  // return length number off digits
  return code.substr(-digits);
};

// Alias counter() for hotp()
exports.counter = exports.hotp;

/**
 * Verify a counter-based one-time token against the secret and return the delta.
 * By default, it verifies the token at the given counter value, with no leeway
 * (no look-ahead or look-behind). A token validated at the current counter value
 * will have a delta of 0.
 *
 * You can specify a window to add more leeway to the verification process.
 * Setting the window param will check for the token at the given counter value
 * as well as `window` tokens ahead (one-sided window). See param for more info.
 *
 * `verifyDelta()` will return the delta between the counter value of the token
 * and the given counter value. For example, if given a counter 5 and a window
 * 10, `verifyDelta()` will look at tokens from 5 to 15, inclusive. If it finds
 * it at counter position 7, it will return `{ delta: 2 }`.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.token Passcode to validate
 * @param {Integer} options.counter Counter value. This should be stored by
 *   the application and must be incremented for each request.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {Integer} [options.window=0] The allowable margin for the counter.
 *   The function will check "W" codes in the future against the provided
 *   passcode, e.g. if W = 10, and C = 5, this function will check the
 *   passcode against all One Time Passcodes between 5 and 15, inclusive.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @return {Object} On success, returns an object with the counter
 *   difference between the client and the server as the `delta` property (i.e.
 *   `{ delta: 0 }`).
 * @method hotp․verifyDelta
 * @global
 */

exports.hotp.verifyDelta = function hotpVerifyDelta (options) {
  var i;

  // shadow options
  options = Object.create(options);

  // unpack options
  var token = options.token;
  var window = parseInt(options.window || 0, 10);
  var counter = parseInt(options.counter || 0, 10);

  // loop from C to C + W
  for (i = counter; i <= counter + window; ++i) {
    options.counter = i;
    if (exports.hotp(options) === token) {
      // found a matching code, return delta
      return {delta: i - counter};
    }
  }

// no codes have matched
};

/**
 * Verify a time-based one-time token against the secret and return true if it
 * verifies. Helper function for `hotp.verifyDelta()`` that returns a boolean
 * instead of an object. For more on how to use a window with this, see
 * {@link hotp.verifyDelta}.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.token Passcode to validate
 * @param {Integer} options.counter Counter value. This should be stored by
 *   the application and must be incremented for each request.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {Integer} [options.window=0] The allowable margin for the counter.
 *   The function will check "W" codes in the future against the provided
 *   passcode, e.g. if W = 10, and C = 5, this function will check the
 *   passcode against all One Time Passcodes between 5 and 15, inclusive.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @return {Boolean} Returns true if the token matches within the given
 *   window, false otherwise.
 * @method hotp․verify
 * @global
 */
exports.hotp.verify = function hotpVerify (options) {
  return exports.hotp.verifyDelta(options) != null;
};

/**
 * Calculate counter value based on given options.
 *
 * @param {Object} options
 * @param {Integer} [options.time] Time with which to calculate counter value.
 *   Defaults to `Date.now()`.
 * @param {Integer} [options.step=30] Time step in seconds
 * @param {Integer} [options.epoch=0] Initial time since the UNIX epoch from
 *   which to calculate the counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.initial_time=0] (DEPRECATED. Use `epoch` instead.)
 *   Initial time since the UNIX epoch from which to calculate the counter
 *   value. Defaults to 0 (no offset).
 * @return {Integer} The calculated counter value
 * @private
 */

exports._counter = function _counter (options) {
  var step = options.step || 30;
  var time = options.time != null ? options.time : Date.now();

  // also accepts 'initial_time', but deprecated
  var epoch = (options.epoch != null ? options.epoch : options.initial_time) || 0;
  if (options.initial_time) console.log('Speakeasy - Deprecation Notice - Specifying the epoch using `initial_time` is no longer supported. Use `epoch` instead.');

  return Math.floor((time - epoch) / step / 1000);
};

/**
 * Generate a time-based one-time token. By default, it returns the token for
 * the current time.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {Integer} [options.time] Time with which to calculate counter value.
 *   Defaults to `Date.now()`.
 * @param {Integer} [options.step=30] Time step in seconds
 * @param {Integer} [options.epoch=0] Initial time since the UNIX epoch from
 *   which to calculate the counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.counter] Counter value, calculated by default.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
 *   Shared secret key
 * @param {Integer} [options.initial_time=0] (DEPRECATED. Use `epoch` instead.)
 *   Initial time since the UNIX epoch from which to calculate the counter
 *   value. Defaults to 0 (no offset).
 * @param {Integer} [options.length=6] (DEPRECATED. Use `digits` instead.) The
 *   number of digits for the one-time passcode.
 * @return {String} The one-time passcode.
 */

exports.totp = function totpGenerate (options) {
  // shadow options
  options = Object.create(options);

  // calculate default counter value
  if (options.counter == null) options.counter = exports._counter(options);

  // pass to hotp
  return this.hotp(options);
};

// Alias time() for totp()
exports.time = exports.totp;

/**
 * Verify a time-based one-time token against the secret and return the delta.
 * By default, it verifies the token at the current time window, with no leeway
 * (no look-ahead or look-behind). A token validated at the current time window
 * will have a delta of 0.
 *
 * You can specify a window to add more leeway to the verification process.
 * Setting the window param will check for the token at the given counter value
 * as well as `window` tokens ahead and `window` tokens behind (two-sided
 * window). See param for more info.
 *
 * `verifyDelta()` will return the delta between the counter value of the token
 * and the given counter value. For example, if given a time at counter 1000 and
 * a window of 5, `verifyDelta()` will look at tokens from 995 to 1005,
 * inclusive. In other words, if the time-step is 30 seconds, it will look at
 * tokens from 2.5 minutes ago to 2.5 minutes in the future, inclusive.
 * If it finds it at counter position 1002, it will return `{ delta: 2 }`.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.token Passcode to validate
 * @param {Integer} [options.time] Time with which to calculate counter value.
 *   Defaults to `Date.now()`.
 * @param {Integer} [options.step=30] Time step in seconds
 * @param {Integer} [options.epoch=0] Initial time since the UNIX epoch from
 *   which to calculate the counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.counter] Counter value, calculated by default.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {Integer} [options.window=0] The allowable margin for the counter.
 *   The function will check "W" codes in the future and the past against the
 *   provided passcode, e.g. if W = 5, and C = 1000, this function will check
 *   the passcode against all One Time Passcodes between 995 and 1005,
 *   inclusive.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @return {Object} On success, returns an object with the time step
 *   difference between the client and the server as the `delta` property (e.g.
 *   `{ delta: 0 }`).
 * @method totp․verifyDelta
 * @global
 */

exports.totp.verifyDelta = function totpVerifyDelta (options) {
  // shadow options
  options = Object.create(options);

  // unpack options
  var window = parseInt(options.window || 0, 10);

  // calculate default counter value
  if (options.counter == null) options.counter = exports._counter(options);

  // adjust for two-sided window
  options.counter -= window;
  options.window += window;

  // pass to hotp.verifyDelta
  return exports.hotp.verifyDelta(options);
};

/**
 * Verify a time-based one-time token against the secret and return true if it
 * verifies. Helper function for verifyDelta() that returns a boolean instead of
 * an object. For more on how to use a window with this, see
 * {@link totp.verifyDelta}.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.token Passcode to validate
 * @param {Integer} [options.time] Time with which to calculate counter value.
 *   Defaults to `Date.now()`.
 * @param {Integer} [options.step=30] Time step in seconds
 * @param {Integer} [options.epoch=0] Initial time since the UNIX epoch from
 *   which to calculate the counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.counter] Counter value, calculated by default.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {Integer} [options.window=0] The allowable margin for the counter.
 *   The function will check "W" codes in the future and the past against the
 *   provided passcode, e.g. if W = 5, and C = 1000, this function will check
 *   the passcode against all One Time Passcodes between 995 and 1005,
 *   inclusive.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @return {Boolean} Returns true if the token matches within the given
 *   window, false otherwise.
 * @method totp․verify
 * @global
 */
exports.totp.verify = function totpVerify (options) {
  return exports.totp.verifyDelta(options) != null;
};

/**
 * @typedef GeneratedSecret
 * @type Object
 * @property {String} ascii ASCII representation of the secret
 * @property {String} hex Hex representation of the secret
 * @property {String} base32 Base32 representation of the secret
 * @property {String} qr_code_ascii URL for the QR code for the ASCII secret.
 * @property {String} qr_code_hex URL for the QR code for the hex secret.
 * @property {String} qr_code_base32 URL for the QR code for the base32 secret.
 * @property {String} google_auth_qr URL for the Google Authenticator otpauth
 *   URL's QR code.
 * @property {String} google_auth_url Google Authenticator otpauth URL.
 */

/**
 * Generates a random secret with the set A-Z a-z 0-9 and symbols, of any length
 * (default 32). Returns the secret key in ASCII, hexadecimal, and base32 format,
 * along with the URL used for the QR code for Google Authenticator (an otpauth
 * URL). Use a QR code library to generate a QR code based on the Google
 * Authenticator URL to obtain a QR code you can scan into the app.
 *
 * @param {Object} options
 * @param {Integer} [options.length=32] Length of the secret
 * @param {Boolean} [options.symbols=false] Whether to include symbols
 * @param {Boolean} [options.google_auth_url=true] Whether to output a Google
 *   Authenticator otpauth:// URL (only returns otpauth:// URL, no QR code)
 * @param {String} [options.name] The name to use with Google Authenticator.
 * @param {Boolean} [options.qr_codes=false] (DEPRECATED. Do not use to prevent
 *   leaking of secret to a third party. Use your own QR code implementation.)
 *   Output QR code URLs for the token.
 * @param {Boolean} [options.google_auth_qr=false] (DEPRECATED. Do not use to
 *   prevent leaking of secret to a third party. Use your own QR code
 *   implementation.) Output a Google Authenticator otpauth:// QR code URL.
 * @return {Object}
 * @return {GeneratedSecret} The generated secret key.
 */
exports.generateSecret = function generateSecret (options) {
  // options
  if (!options) options = {};
  var length = options.length || 32;
  var name = encodeURIComponent(options.name) || 'SecretKey';
  var qr_codes = options.qr_codes || false;
  var google_auth_qr = options.google_auth_qr || false;
  var google_auth_url = options.google_auth_url != null ? options.google_auth_url : true;
  var symbols = true;

  // turn off symbols only when explicity told to
  if (options.symbols !== undefined && options.symbols === false) {
    symbols = false;
  }

  // generate an ascii key
  var key = this.generate_key_ascii(length, symbols);

  // return a SecretKey with ascii, hex, and base32
  var SecretKey = {};
  SecretKey.ascii = key;
  SecretKey.hex = Buffer(key, 'ascii').toString('hex');
  SecretKey.base32 = base32.encode(Buffer(key)).toString().replace(/=/g, '');

  // generate some qr codes if requested
  if (qr_codes) {
    console.log('Speakeasy - Deprecation Notice - generateSecret() QR codes are deprecated and no longer supported. Please use your own QR code implementation.');
    SecretKey.qr_code_ascii = 'https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=' + encodeURIComponent(SecretKey.ascii);
    SecretKey.qr_code_hex = 'https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=' + encodeURIComponent(SecretKey.hex);
    SecretKey.qr_code_base32 = 'https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=' + encodeURIComponent(SecretKey.base32);
  }

  // add in the Google Authenticator-compatible otpauth URL
  if (google_auth_url) {
    SecretKey.google_auth_url = exports.googleAuthURL({
      secret: SecretKey.base32,
      label: name
    });
  }

  // generate a QR code for use in Google Authenticator if requested
  if (google_auth_qr) {
    console.log('Speakeasy - Deprecation Notice - generateSecret() Google Auth QR code is deprecated and no longer supported. Please use your own QR code implementation.');
    SecretKey.google_auth_qr = 'https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=' + encodeURIComponent(exports.googleAuthURL({ secret: SecretKey.base32, label: name }));
  }

  return SecretKey;
};

// Backwards compatibility - generate_key is deprecated
exports.generate_key = util.deprecate(function (options) {
  return exports.generateSecret(options);
}, 'Speakeasy - Deprecation Notice - `generate_key()` is depreciated, please use `generateSecret()` instead.');

/**
 * Generates a key of a certain length (default 32) from A-Z, a-z, 0-9, and
 * symbols (if requested).
 *
 * @param  {Integer} [length=32]  The length of the key.
 * @param  {Boolean} [symbols=false] Whether to include symbols in the key.
 * @return {String} The generated key.
 */
exports.generateSecretASCII = function generateSecretASCII (length, symbols) {
  var bytes = crypto.randomBytes(length || 32);
  var set = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz';
  if (symbols) {
    set += '!@#$%^&*()<>?/[]{},.:;';
  }

  var output = '';
  for (var i = 0, l = bytes.length; i < l; i++) {
    output += set[Math.floor(bytes[i] / 255.0 * (set.length - 1))];
  }
  return output;
};

// Backwards compatibility - generate_key_ascii is deprecated
exports.generate_key_ascii = util.deprecate(function (length, symbols) {
  return exports.generateSecretASCII(length, symbols);
}, 'Speakeasy - Deprecation Notice - `generate_key_ascii()` is depreciated, please use `generateSecretASCII()` instead.');

/**
 * Generate an URL for use with the Google Authenticator app.
 *
 * Authenticator considers TOTP codes valid for 30 seconds. Additionally,
 * the app presents 6 digits codes to the user. According to the
 * documentation, the period and number of digits are currently ignored by
 * the app.
 *
 * To generate a suitable QR Code, pass the generated URL to a QR Code
 * generator, such as the `qr-image` module.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.label Used to identify the account with which
 *   the secret key is associated, e.g. the user's email address.
 * @param {String} [options.type="totp"] Either "hotp" or "totp".
 * @param {Integer} [options.counter] The initial counter value, required
 *   for HOTP.
 * @param {String} [options.issuer] The provider or service with which the
 *   secret key is associated.
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode. Currently ignored by Google Authenticator.
 * @param {Integer} [options.period=30] The length of time for which a TOTP
 *   code will be valid, in seconds. Currently ignored by Google
 *   Authenticator.
 * @param {String} [options.encoding] Key encoding (ascii, hex, base32,
 *   base64). If the key is not encoded in Base-32, it will be reencoded.
 * @return {String} A URL suitable for use with the Google Authenticator.
 * @see https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 */

exports.googleAuthURL = function googleAuthURL (options) {
  // unpack options
  var secret = options.secret;
  var label = options.label;
  var issuer = options.issuer;
  var type = (options.type || 'totp').toLowerCase();
  var counter = options.counter;
  var algorithm = options.algorithm;
  var digits = options.digits;
  var period = options.period;
  var encoding = options.encoding;

  // validate type
  switch (type) {
    case 'totp':
    case 'hotp':
      break;
    default:
      throw new Error('invalid type `' + type + '`');
  }

  // validate required options
  if (!secret) throw new Error('missing secret');
  if (!label) throw new Error('missing label');

  // require counter for HOTP
  if (type === 'hotp' && (counter === null || typeof counter === 'undefined')) {
    throw new Error('missing counter value for HOTP');
  }

  // build query while validating
  var query = {secret: secret};
  if (issuer) query.issuer = issuer;

  // validate algorithm
  if (algorithm != null) {
    switch (algorithm.toUpperCase()) {
      case 'SHA1':
      case 'SHA256':
      case 'SHA512':
        break;
      default:
        throw new Error('invalid algorithm `' + algorithm + '`');
    }
    query.algorithm = algorithm.toUpperCase();
  }

  // validate digits
  if (digits != null) {
    switch (parseInt(digits, 10)) {
      case 6:
      case 8:
        break;
      default:
        throw new Error('invalid digits `' + digits + '`');
    }
    query.digits = digits;
  }

  // validate period
  if (period != null) {
    period = parseInt(period, 10);
    if (~~period !== period) {
      throw new Error('invalid period `' + period + '`');
    }
    query.period = period;
  }

  // convert secret to base32
  if (encoding !== 'base32') secret = new Buffer(secret, encoding);
  if (Buffer.isBuffer(secret)) secret = base32.encode(secret);

  // return url
  return url.format({
    protocol: 'otpauth',
    slashes: true,
    hostname: type,
    pathname: label,
    query: query
  });
};
