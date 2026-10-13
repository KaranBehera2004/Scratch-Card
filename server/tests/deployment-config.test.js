import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("frontend deployment proxies API before the SPA fallback and disables API caching", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "client/vercel.json"), "utf8"));
  const apiIndex = config.rewrites.findIndex((rule) => rule.source === "/api/:path*");
  const fallbackIndex = config.rewrites.findIndex((rule) => rule.source === "/(.*)");
  assert.ok(apiIndex >= 0, "client/vercel.json must proxy /api/*");
  assert.ok(fallbackIndex > apiIndex, "the /api proxy must run before the SPA fallback");
  assert.equal(config.rewrites[apiIndex].destination,
    "https://api-scratch.justconnect.biz/api/:path*");
  const apiHeaders = config.headers.find((rule) => rule.source === "/api/:path*")?.headers || [];
  assert.match(apiHeaders.find((header) => header.key.toLowerCase() === "cache-control")?.value || "", /no-store/);
  assert.equal(apiHeaders.find((header) => header.key.toLowerCase() === "x-vercel-enable-rewrite-caching")?.value, "0");
});

test("production environment template contains every required durability setting", () => {
  const example = fs.readFileSync(path.join(root, "server/config/env/.env.production.example"), "utf8");
  for (const key of ["NODE_ENV", "CLIENT_ORIGIN", "MONGODB_URI", "MONGODB_DB", "AUTH_SECRET"])
    assert.match(example, new RegExp(`^${key}=`, "m"));
});
