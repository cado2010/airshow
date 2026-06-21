// Bundles the server (Express API + ADS-B proxy + SSE) into a single CommonJS
// file the Electron main process can require: electron/server.cjs. Bundling
// avoids shipping the workspace's node_modules tree with the packaged app.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "server", "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(root, "electron", "server.cjs"),
  // electron is provided by the runtime; never bundle it.
  external: ["electron"],
  logLevel: "info",
});

console.log("electron/server.cjs bundled");
