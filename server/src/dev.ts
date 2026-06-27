import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./index.js";

// Standalone / dev entry point: start the API server on PORT (default 8787).
// In dev the Vite server proxies (and the browser connects directly) to it.
// Set STATIC_DIR to also serve a built frontend (e.g. ../app/dist) from the
// same origin — handy for hosting the production bundle.
const here = path.dirname(fileURLToPath(import.meta.url));
const staticEnv = process.env.STATIC_DIR;
const staticDir = staticEnv
  ? path.isAbsolute(staticEnv)
    ? staticEnv
    : path.resolve(here, "..", staticEnv)
  : undefined;

// Terminate TLS when both PEM paths are provided (e.g. a Let's Encrypt cert):
//   TLS_KEY_PATH=...\privkey.pem  TLS_CERT_PATH=...\fullchain.pem
const keyPath = process.env.TLS_KEY_PATH;
const certPath = process.env.TLS_CERT_PATH;
const tls =
  keyPath && certPath
    ? { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") }
    : undefined;

// Auth is on by default for the exposed standalone host; set AIRSHOW_AUTH=0 to
// disable (e.g. a throwaway local dev session).
const auth = process.env.AIRSHOW_AUTH !== "0";

void startServer({ staticDir, tls, auth });
