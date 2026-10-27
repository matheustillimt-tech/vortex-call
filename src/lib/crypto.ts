import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export function segredoAleatorio(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function segredosIguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`${env("CRYPTO_KEY")}:${ip}`).digest("hex").slice(0, 32);
}
