import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response, NextFunction } from "express";

// Email/password auth with HS256 JWTs. No external deps — password hashing,
// JWT signing/verification and the shared secret all use Node's `crypto`.
//
// Users live in server/creds/users.json (git-ignored), each as
//   { "email": "...", "hash": "scrypt$<saltHex>$<keyHex>", "role": "admin" }
// Add them with scripts/add-user.mjs (never store plaintext).

export interface User {
  email: string;
  hash: string;
  role?: string;
}

export interface Claims {
  email: string;
  role?: string;
}

// Resolve the creds dir across runtimes (tsx/ESM dev + esbuild CJS bundle),
// mirroring server/src/opensky.ts.
const here = typeof __dirname !== "undefined" ? __dirname : process.cwd();
const CREDS_DIRS = [
  process.env.AIRSHOW_CREDS_DIR,
  join(process.cwd(), "server", "creds"),
  join(here, "creds"),
  join(here, "..", "creds"),
  join(here, "..", "server", "creds"),
].filter(Boolean) as string[];

function findCredsFile(name: string): string | null {
  for (const d of CREDS_DIRS) {
    const p = join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Users + password hashing (salted scrypt)
// ---------------------------------------------------------------------------

function loadUsers(): User[] {
  const p = process.env.AIRSHOW_USERS ?? findCredsFile("users.json");
  if (!p) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? (parsed as User[]) : [];
  } catch {
    return [];
  }
}

/** Hash a password as `scrypt$<saltHex>$<keyHex>` (used by scripts/add-user). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(password, salt, expected.length);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared secret (persisted if possible, else in-memory for the process)
// ---------------------------------------------------------------------------

let secretCache: Buffer | null = null;
function secret(): Buffer {
  if (secretCache) return secretCache;
  const env = process.env.AIRSHOW_JWT_SECRET;
  if (env) {
    secretCache = Buffer.from(env, "utf8");
    return secretCache;
  }
  const existing = findCredsFile("session_secret");
  if (existing) {
    try {
      const hex = readFileSync(existing, "utf8").trim();
      const buf = Buffer.from(hex, "hex");
      if (buf.length >= 16) {
        secretCache = buf;
        return secretCache;
      }
    } catch {
      /* fall through to generate */
    }
  }
  const buf = randomBytes(32);
  for (const d of CREDS_DIRS) {
    try {
      writeFileSync(join(d, "session_secret"), buf.toString("hex"));
      break;
    } catch {
      /* read-only (e.g. packaged app) — keep it in memory */
    }
  }
  secretCache = buf;
  return secretCache;
}

// ---------------------------------------------------------------------------
// JWT (HS256)
// ---------------------------------------------------------------------------

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlJson(obj: unknown): string {
  return b64url(Buffer.from(JSON.stringify(obj)));
}

const TOKEN_TTL_SEC = 7 * 24 * 3600;

export function signJwt(claims: Claims): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({ ...claims, iat: now, exp: now + TOKEN_TTL_SEC });
  const data = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", secret()).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyJwt(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = b64url(createHmac("sha256", secret()).update(data).digest());
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const body = JSON.parse(json) as Claims & { exp?: number };
    if (typeof body.exp === "number" && Math.floor(Date.now() / 1000) > body.exp) {
      return null;
    }
    if (typeof body.email !== "string") return null;
    return { email: body.email, role: body.role };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Express handlers + middleware
// ---------------------------------------------------------------------------

// Per-IP login throttle to slow brute force.
const attempts = new Map<string, { n: number; first: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) return false;
  return rec.n >= MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { n: 1, first: now });
  } else {
    rec.n += 1;
  }
}

export function loginHandler(req: Request, res: Response): void {
  const ip = req.ip ?? "?";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  const user = loadUsers().find(
    (u) => u.email.toLowerCase() === email.toLowerCase(),
  );
  if (!user || !verifyPassword(password, user.hash)) {
    recordFailure(ip);
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  attempts.delete(ip);
  const token = signJwt({ email: user.email, role: user.role });
  res.json({ token, email: user.email });
}

interface AuthedRequest extends Request {
  user?: Claims;
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  // EventSource can't send headers, so the SSE client passes ?token=...
  if (typeof req.query.token === "string") return req.query.token;
  return undefined;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = bearer(req);
  const claims = token ? verifyJwt(token) : null;
  if (!claims) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthedRequest).user = claims;
  next();
}

export function meHandler(req: Request, res: Response): void {
  res.json({ email: (req as AuthedRequest).user?.email });
}
