// Add or update an AirShow login user. Stores only a salted scrypt hash in
// server/creds/users.json (git-ignored) — never the plaintext password.
//
// Usage:
//   node scripts/add-user.mjs --email you@example.com [--role admin]
//     (prompts for the password, hidden)
//   AIRSHOW_PW='secret' node scripts/add-user.mjs --email you@example.com
//     (non-interactive, e.g. for seeding)
import { scryptSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const credsDir = join(root, "server", "creds");
const usersPath = join(credsDir, "users.json");

function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hiddenQuestion(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.stdoutMuted = false;
    rl._writeToOutput = (s) =>
      process.stdout.write(rl.stdoutMuted ? "*" : s);
    rl.question(query, (val) => {
      rl.close();
      process.stdout.write("\n");
      resolve(val);
    });
    rl.stdoutMuted = true;
  });
}

const email = (arg("--email") || process.env.AIRSHOW_EMAIL || "").trim();
const role = arg("--role") || process.env.AIRSHOW_ROLE || "user";
if (!email) {
  console.error("error: --email is required");
  process.exit(1);
}

const password = process.env.AIRSHOW_PW ?? (await hiddenQuestion("Password: "));
if (!password) {
  console.error("error: password is required");
  process.exit(1);
}

let users = [];
if (existsSync(usersPath)) {
  try {
    const parsed = JSON.parse(readFileSync(usersPath, "utf8"));
    if (Array.isArray(parsed)) users = parsed;
  } catch {
    /* start fresh */
  }
}

const hash = hashPassword(password);
const existing = users.find(
  (u) => (u.email || "").toLowerCase() === email.toLowerCase(),
);
if (existing) {
  existing.hash = hash;
  existing.role = role;
} else {
  users.push({ email, hash, role, createdAt: Date.now() });
}

mkdirSync(credsDir, { recursive: true });
writeFileSync(usersPath, JSON.stringify(users, null, 2) + "\n");
console.log(`${existing ? "Updated" : "Added"} ${email} (role: ${role}) in ${usersPath}`);
