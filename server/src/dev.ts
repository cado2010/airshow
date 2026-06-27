import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./index.js";

// Standalone / dev entry point: start the API server on PORT (default 8787).
// In dev the Vite server proxies (and the browser connects directly) to it.
// Set STATIC_DIR to also serve a built frontend (e.g. ../app/dist) from the
// same origin — handy for hosting the production bundle over plain HTTP.
const here = path.dirname(fileURLToPath(import.meta.url));
const staticEnv = process.env.STATIC_DIR;
const staticDir = staticEnv
  ? path.isAbsolute(staticEnv)
    ? staticEnv
    : path.resolve(here, "..", staticEnv)
  : undefined;

void startServer({ staticDir });
