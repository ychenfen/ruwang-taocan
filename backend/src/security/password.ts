import crypto from "node:crypto";

type ScryptParams = Readonly<{
  N: number;
  r: number;
  p: number;
  dkLen: number;
}>;

const DEFAULT_PARAMS: ScryptParams = {
  // Reasonable defaults; can be bumped later with versioning in the stored hash.
  N: 16384,
  r: 8,
  p: 1,
  dkLen: 32,
};

function b64(buf: Buffer): string {
  return buf.toString("base64");
}

function fromB64(s: string): Buffer {
  return Buffer.from(s, "base64");
}

export function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, params.dkLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 64 * 1024 * 1024,
  });

  // Format: scrypt$N$r$p$saltB64$keyB64
  return ["scrypt", String(params.N), String(params.r), String(params.p), b64(salt), b64(key)].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [algo, N, r, p, saltB64, keyB64] = parts;
  if (algo !== "scrypt") return false;

  const params: ScryptParams = {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    dkLen: fromB64(keyB64).length,
  };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p) || params.dkLen <= 0) return false;

  const salt = fromB64(saltB64);
  const expected = fromB64(keyB64);
  const actual = crypto.scryptSync(password, salt, params.dkLen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 64 * 1024 * 1024,
  });

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

