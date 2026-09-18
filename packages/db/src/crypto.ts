import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("OAUTH_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function encryptSecret(plaintext: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromBase64(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, keyBase64: string): string {
  const [version, iv, tag, ciphertext] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("invalid encrypted secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", keyFromBase64(keyBase64), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
