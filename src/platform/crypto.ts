import crypto from "node:crypto";
import { platformConfig } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const key = Buffer.from(platformConfig.encryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key)");
  }
  return key;
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), secret.iv);
  decipher.setAuthTag(secret.authTag);
  return Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]).toString("utf8");
}
