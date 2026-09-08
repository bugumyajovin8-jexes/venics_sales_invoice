/**
 * Tamper seal for the locally stored licence.
 *
 * This is what used to live in `utils/encryption.ts` alongside a pair of AES
 * helpers. It was never encryption: an HMAC hides nothing, it only lets the app
 * notice that the licence row on this device has been edited. That is the
 * `TAMPERED` status LicenseGuard acts on, and it is the only thing stopping
 * someone opening devtools, pushing `expiryDate` out by ten years, and using
 * the app for free forever. The AES half was deleted; this half is the reason
 * the file still exists.
 *
 * The single-algorithm import matters. `import CryptoJS from 'crypto-js'` pulls
 * the whole library — every cipher, every encoder — into the entry chunk for the
 * sake of one hash.
 */

import HmacSHA256 from 'crypto-js/hmac-sha256';

const HMAC_KEY = 'pos-app-hmac-key-v1';

export const generateHMAC = (data: string): string => HmacSHA256(data, HMAC_KEY).toString();

export const verifyHMAC = (data: string, signature: string): boolean =>
  generateHMAC(data) === signature;
