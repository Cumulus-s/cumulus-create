// SPDX-License-Identifier: AGPL-3.0-only
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface WrappedEncryptedString {
  version: 1;
  alg: 'AES-256-GCM';
  kek: 'provider-local';
  aad: Record<string, unknown>;
  wrappedDek: string;
  ciphertext: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function encryptString(value: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]).toString('base64');
}

export function decryptString(payload: string, key: Buffer): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < 29) throw new Error('encrypted payload is too short');
  const nonce = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function aadBytes(aad: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(aad), 'utf8');
}

function encryptStringWithAad(value: string, key: Buffer, aad: Record<string, unknown>): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aadBytes(aad));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]).toString('base64');
}

function decryptStringWithAad(payload: string, key: Buffer, aad: Record<string, unknown>): string {
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < 29) throw new Error('encrypted payload is too short');
  const nonce = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aadBytes(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function encryptStringWithWrappedDek(
  value: string,
  keyEncryptionKey: Buffer,
  aad: Record<string, unknown>,
): WrappedEncryptedString {
  const dek = randomBytes(32);
  return {
    version: 1,
    alg: 'AES-256-GCM',
    kek: 'provider-local',
    aad,
    wrappedDek: encryptString(dek.toString('base64'), keyEncryptionKey),
    ciphertext: encryptStringWithAad(value, dek, aad),
  };
}

export function decryptStringWithWrappedDek(payload: WrappedEncryptedString, keyEncryptionKey: Buffer): string {
  const dek = Buffer.from(decryptString(payload.wrappedDek, keyEncryptionKey), 'base64');
  if (dek.length !== 32) throw new Error('wrapped snapshot DEK is invalid');
  return decryptStringWithAad(payload.ciphertext, dek, payload.aad);
}
