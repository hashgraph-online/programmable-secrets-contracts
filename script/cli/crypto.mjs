import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function toHexString(buffer) {
  return `0x${Buffer.from(buffer).toString('hex')}`;
}

export function parseHexBuffer(value, description) {
  const trimmed = `${value}`.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new Error(`Invalid ${description}. Expected a 0x-prefixed even-length hex string.`);
  }
  return Buffer.from(trimmed.slice(2), 'hex');
}

export function zeroHash() {
  return `0x${'0'.repeat(64)}`;
}

export function sha256Hex(value) {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}

export function encryptPayload(plaintextBuffer) {
  const contentKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
  const ciphertextBody = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    contentKey,
    iv,
    ciphertext: Buffer.concat([ciphertextBody, tag]),
  };
}

export function decryptPayload({ ciphertext, contentKey, iv }) {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const body = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', contentKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
