// Electron main process: boots the embedded API/stream server on a free local
// port, then loads the built frontend from that same origin so the SSE stream
// and all /api + /logos requests are same-origin (no proxy buffering, no CORS).
const { app, BrowserWindow, shell, nativeTheme, Menu } = require("electron");
const path = require("node:path");

// The server is bundled to a single CommonJS file next to this one at build
// time (see scripts/build-electron.mjs). In dev we fall back to the source via
// the AIRSHOW_DEV_URL flow below, so this require is only used for packaged runs.
let startServer = null;
try {
  ({ startServer } = require("./server.cjs"));
} catch {
  /* dev mode (AIRSHOW_DEV_URL) doesn't need the bundled server */
}

const DEV_URL = process.env.AIRSHOW_DEV_URL; // e.g. http://localhost:5173

let mainWindow = null;
let running = null; // { port, close }

async function boot() {
  // Match the app's dark UI: force a dark native title bar / window chrome
  // (otherwise Windows draws a white frame in light system themes), and drop
  // the default menu bar so the window reads like Cursor's agent window.
  nativeTheme.themeSource = "dark";
  // On Windows/Linux drop the menu bar entirely (Cursor-like). On macOS keep the
  // standard application menu so Cmd+Q / copy-paste / window shortcuts work.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);

  let url = DEV_URL;

  if (!url) {
    if (!startServer) {
      throw new Error("bundled server not found (electron/server.cjs)");
    }
    // Serve the built frontend that sits alongside this file.
    const staticDir = path.join(__dirname, "..", "app", "dist");
    // Require login in the desktop shell too (single user, but per request).
    running = await startServer({ port: 0, staticDir, auth: true });
    url = `http://localhost:${running.port}`;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#000000",
    title: "AirShow",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the user's browser, not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(url);
}

app.whenReady().then(boot).catch((err) => {
  console.error("[airshow] failed to start:", err);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void boot();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (running) void running.close().catch(() => {});
});
