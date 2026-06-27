// Update the password of an EXISTING AirShow user. Unlike add-user.mjs this
// never creates a new user and never changes the user's role — it only rewrites
// the salted scrypt hash in server/creds/users.json (git-ignored).
//
// Usage:
//   node scripts/set-password.mjs --email you@example.com
//     (prompts for the password, hidden)
//   AIRSHOW_PW='secret' node scripts/set-password.mjs --email you@example.com
//     (non-interactive)
import { scryptSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const usersPath = join(root, "server", "creds", "users.json");

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
if (!email) {
  console.error("error: --email is required");
  process.exit(1);
}

if (!existsSync(usersPath)) {
  console.error(`error: no users file at ${usersPath}`);
  process.exit(1);
}

let users = [];
try {
  const parsed = JSON.parse(readFileSync(usersPath, "utf8"));
  if (Array.isArray(parsed)) users = parsed;
} catch {
  console.error(`error: could not parse ${usersPath}`);
  process.exit(1);
}

const user = users.find(
  (u) => (u.email || "").toLowerCase() === email.toLowerCase(),
);
if (!user) {
  console.error(
    `error: user '${email}' not found. Use add-user.ps1 to create a new user.`,
  );
  process.exit(1);
}

const password = process.env.AIRSHOW_PW ?? (await hiddenQuestion("New password: "));
if (!password) {
  console.error("error: password is required");
  process.exit(1);
}

user.hash = hashPassword(password);
user.passwordUpdatedAt = Date.now();

writeFileSync(usersPath, JSON.stringify(users, null, 2) + "\n");
console.log(`Updated password for ${user.email} (role: ${user.role}).`);
