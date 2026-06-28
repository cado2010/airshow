import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import type { Request, Response, NextFunction } from "express";

// Lightweight access log. Appends one JSON object per request (JSON-lines) with:
//   ts     — UTC ISO-8601 timestamp
//   ip     — remote WAN IP (IPv4-mapped IPv6 normalized to plain IPv4)
//   user   — authenticated user id (email), or the attempted login email, else "-"
//   method, path, status, ms — useful context (path has the query string — and
//            thus the SSE ?token= — stripped so secrets never hit the log).
// Decode/list it with: npm run logs  (scripts/show-log.mjs)

interface AuthedReq extends Request {
  user?: { email?: string };
}

export function createAccessLogger(file: string) {
  mkdirSync(dirname(file), { recursive: true });
  const stream: WriteStream = createWriteStream(file, { flags: "a" });

  return function accessLog(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    // Log when the response completes so requireAuth has populated req.user.
    res.on("finish", () => {
      let ip = req.ip || req.socket.remoteAddress || "-";
      if (ip.startsWith("::ffff:")) ip = ip.slice(7); // dual-stack IPv4-mapped
      const body = req.body as { email?: unknown } | undefined;
      const user =
        (req as AuthedReq).user?.email ??
        (typeof body?.email === "string" ? body.email : undefined) ??
        "-";
      const entry = {
        ts: new Date().toISOString(),
        ip,
        user,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Date.now() - start,
      };
      stream.write(JSON.stringify(entry) + "\n");
    });
    next();
  };
}
