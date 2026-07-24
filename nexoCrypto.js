// --------------- Adyen Nexo (Terminal API) local message encryption ---------------
// Faithful port of Adyen's NexoCrypto algorithm (adyen-node-api-library) using
// only Node's built-in `crypto` module.
//
// Key derivation: PBKDF2-HMAC-SHA1, salt "AdyenNexoV1Salt", 4000 iterations,
//   80 bytes => [0..32) hmacKey, [32..64) cipherKey, [64..80) iv.
// Encryption: AES-256-CBC, actualIV = derivedIV XOR randomNonce(16 bytes).
// Integrity: HMAC-SHA256 over the PLAINTEXT message using hmacKey.

const { createCipheriv, createHmac, pbkdf2Sync, randomBytes } = require('crypto');

const HMAC_KEY_LENGTH = 32;
const CIPHER_KEY_LENGTH = 32;
const IV_LENGTH = 16;

function deriveKeyMaterial(passphrase) {
  const pass = Buffer.from(passphrase, 'binary');
  const salt = Buffer.from('AdyenNexoV1Salt', 'binary');
  const iterations = 4000;
  const keylen = CIPHER_KEY_LENGTH + HMAC_KEY_LENGTH + IV_LENGTH; // 80
  // NB: Adyen requests `keylen * 8` bytes; PBKDF2 output is a prefix, so the
  // first 80 bytes are identical. We replicate it to stay byte-compatible.
  const key = pbkdf2Sync(pass, salt, iterations, keylen * 8, 'sha1');
  return {
    hmacKey: key.slice(0, HMAC_KEY_LENGTH),
    cipherKey: key.slice(HMAC_KEY_LENGTH, HMAC_KEY_LENGTH + CIPHER_KEY_LENGTH),
    iv: key.slice(HMAC_KEY_LENGTH + CIPHER_KEY_LENGTH, HMAC_KEY_LENGTH + CIPHER_KEY_LENGTH + IV_LENGTH)
  };
}

function xorIv(derivedIv, nonce) {
  const actual = Buffer.alloc(IV_LENGTH);
  for (let i = 0; i < IV_LENGTH; i++) {
    actual[i] = derivedIv[i] ^ nonce[i];
  }
  return actual;
}

function hmacPlaintext(bytes, hmacKey) {
  return createHmac('sha256', hmacKey).update(bytes).digest();
}

/**
 * Encrypt a Terminal API (SaleToPOIRequest) JSON string into a secured message.
 * @param {object} messageHeader - The SaleToPOIRequest.MessageHeader object.
 * @param {string} saleToPoiMessageJson - JSON string of the full TerminalApiRequest.
 * @param {{AdyenCryptoVersion:number,KeyIdentifier:string,KeyVersion:number,Passphrase:string}} securityKey
 * @returns {{MessageHeader:object,NexoBlob:string,SecurityTrailer:object}}
 */
function encrypt(messageHeader, saleToPoiMessageJson, securityKey) {
  if (!securityKey || !securityKey.Passphrase || !securityKey.KeyIdentifier ||
      isNaN(securityKey.KeyVersion) || isNaN(securityKey.AdyenCryptoVersion)) {
    throw new Error('Invalid Nexo security key configuration');
  }

  const derivedKey = deriveKeyMaterial(securityKey.Passphrase);
  const messageBytes = Buffer.from(saleToPoiMessageJson, 'utf-8');
  const nonce = randomBytes(IV_LENGTH);
  const actualIv = xorIv(derivedKey.iv, nonce);

  const cipher = createCipheriv('aes-256-cbc', derivedKey.cipherKey, actualIv);
  const encrypted = Buffer.concat([cipher.update(messageBytes), cipher.final()]);
  const hmac = hmacPlaintext(messageBytes, derivedKey.hmacKey);

  return {
    MessageHeader: messageHeader,
    NexoBlob: encrypted.toString('base64'),
    SecurityTrailer: {
      AdyenCryptoVersion: securityKey.AdyenCryptoVersion,
      Hmac: hmac.toString('base64'),
      KeyIdentifier: securityKey.KeyIdentifier,
      KeyVersion: securityKey.KeyVersion,
      Nonce: nonce.toString('base64')
    }
  };
}

module.exports = { encrypt };
