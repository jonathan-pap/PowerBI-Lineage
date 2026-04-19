#!/usr/bin/env node
/**
 * serve-browser.mjs — tiny static server for local testing of the
 * browser build under a real HTTP origin (the File System Access API
 * requires HTTPS or localhost; `file://` isn't enough).
 *
 * Zero-deps — stdlib `http` only, mirroring the app's ethos.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(__dirname, "..", "docs");

if (!existsSync(docsDir) || !existsSync(join(docsDir, "index.html"))) {
  console.error("docs/index.html missing. Run `npm run build:browser` first.");
  process.exit(1);
}

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js",   "application/javascript; charset=utf-8"],
  [".mjs",  "application/javascript; charset=utf-8"],
  [".css",  "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg",  "image/svg+xml"],
  [".png",  "image/png"],
  [".ico",  "image/x-icon"],
]);

const BIND_HOST = "127.0.0.1";
const BIND_PORT_START = 5700;
const BIND_PORT_MAX = BIND_PORT_START + 20;

const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  const safe = url.replace(/\.\.+/g, "").replace(/\/+/g, "/");
  const target = safe === "/" ? "/index.html" : safe;
  const filePath = join(docsDir, target);

  if (!filePath.startsWith(docsDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404).end("Not found: " + url);
    return;
  }

  const mime = MIME.get(extname(filePath).toLowerCase()) || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  res.end(readFileSync(filePath));
});

let port = BIND_PORT_START;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    port++;
    if (port >= BIND_PORT_MAX) {
      console.error(`All ports ${BIND_PORT_START}..${BIND_PORT_MAX - 1} in use.`);
      process.exit(1);
    }
    server.listen(port, BIND_HOST);
    return;
  }
  console.error(e);
  process.exit(1);
});

server.listen(port, BIND_HOST, () => {
  const url = `http://${BIND_HOST}:${port}`;
  console.log(`\n  Browser build → ${url}\n`);
  const cmd = process.platform === "win32" ? `start "" "${url}"`
    : process.platform === "darwin" ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd);
});
