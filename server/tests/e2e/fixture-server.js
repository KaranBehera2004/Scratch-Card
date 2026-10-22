import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";

// This fixture never loads project secrets or connects to the user's database.
const fixture = await fs.mkdtemp(
  path.join(os.tmpdir(), "scratch-browser-test-"),
);
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: path.join(fixture, "no-env"),
  SCRATCH_DATA_ROOT: fixture,
  MONGODB_URI: "",
  AUTH_SECRET: "browser-fixture-private-test-secret",
  SUPER_ADMIN_EMAIL: "platform@example.test",
  SUPER_ADMIN_PASSWORD: "Platform-Test-Password",
  IMPACT_VIBES_EMAIL: "owner@example.test",
  IMPACT_VIBES_PASSWORD: "Owner-Test-Password",
});
for (const key of ["NETLIFY", "VERCEL", "AWS_LAMBDA_FUNCTION_NAME"])
  delete process.env[key];
const { app, connectDatabase } = await import("../../src/app/index.js");
await connectDatabase();
app.use(express.static(path.resolve("../client/dist")));
app.get("/*splat", (_req, res) =>
  res.sendFile(path.resolve("../client/dist/index.html")),
);
const server = app.listen(5099, "127.0.0.1");
export const ready = new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
// Seed expiry only in this isolated browser fixture, never through a public API.
export async function expireCoupons(slugs) {
  const file = path.join(fixture, "server/data/cards.json");
  const cards = JSON.parse(await fs.readFile(file, "utf8"));
  const selected = new Set(slugs);
  for (const card of cards) if (selected.has(card.slug)) card.expiresAt = "2020-01-01T00:00:00.000Z";
  await fs.writeFile(file, JSON.stringify(cards));
}
export async function close() {
  await new Promise((resolve) => server.close(resolve));
  const resolved = await fs.realpath(fixture);
  // Compare real paths: Windows can report TEMP as an 8.3 short name.
  const expected = path.join(await fs.realpath(os.tmpdir()), path.basename(fixture));
  if (
    resolved.toLowerCase() === expected.toLowerCase() &&
    path.basename(resolved).startsWith("scratch-browser-test-")
  )
    await fs.rm(resolved, { recursive: true, force: true });
}
