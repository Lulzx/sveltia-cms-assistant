// A static file server for trying the built admin locally.
//
//   node scripts/serve.mjs [--dir dist] [--port 8080]
//
// It binds to 127.0.0.1 only: a bundle built with secrets must not be reachable
// from the network. On localhost Sveltia also offers "Work with Local
// Repository" (Chromium browsers), which edits a checkout on disk with no
// token at all.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    dir: { type: "string", default: "dist" },
    port: { type: "string", default: "8080" },
  },
});

const root = resolve(args.dir);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer(async (request, response) => {
  let file;
  try {
    file = normalize(join(root, decodeURIComponent(new URL(request.url, "http://localhost").pathname)));
  } catch {
    response.writeHead(400).end();
    return;
  }
  // root + sep, so a sibling like dist-old/ does not pass as inside dist/.
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}).listen(Number(args.port), "127.0.0.1", () => {
  console.log(`serving ${root} at http://localhost:${args.port}/`);
});
