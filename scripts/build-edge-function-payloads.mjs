#!/usr/bin/env node
// Helper used while deploying the Dropbox Edge Functions via the Supabase MCP.
// Prints a JSON file list for a given function slug, including the _shared
// modules so relative imports resolve in the deployed function.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const workspaceRoot = path.resolve(new URL("..", import.meta.url).pathname);
const functionsRoot = path.join(workspaceRoot, "supabase", "functions");

function readFile(relPath) {
  const full = path.join(functionsRoot, relPath);
  return fs.readFileSync(full, "utf8");
}

const SHARED_FILES = ["cors.ts", "auth.ts", "dropbox.ts", "state.ts"];

function buildPayload(slug) {
  const indexRel = path.posix.join(slug, "index.ts");
  const files = [
    { name: indexRel, content: readFile(indexRel) },
  ];
  for (const shared of SHARED_FILES) {
    const rel = path.posix.join("_shared", shared);
    files.push({ name: rel, content: readFile(rel) });
  }
  return files;
}

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: build-edge-function-payloads.mjs <function-slug>");
  process.exit(1);
}

process.stdout.write(JSON.stringify(buildPayload(slug)));
