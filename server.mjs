import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const port = Number(process.env.PORT) || 3000;
const runtimeConfig = {
  supabaseUrl: process.env.VITE_SUPABASE_URL || "",
  supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || "",
  brandAssetBucket: process.env.VITE_BRAND_ASSET_BUCKET || "onboarding-brand-assets",
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const safePath = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  return path.join(rootDir, normalized);
}

const server = http.createServer((req, res) => {
  const requestPath = (req.url || "/").split("?")[0];
  if (requestPath === "/runtime-config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    const serialized = JSON.stringify(runtimeConfig).replace(/</g, "\\u003c");
    res.end(`window.__P11_CONFIG__ = ${serialized};`);
    return;
  }

  const filePath = resolvePath(req.url || "/");
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypes[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
