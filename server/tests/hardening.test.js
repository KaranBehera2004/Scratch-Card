import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { UNEXPECTED_ERROR_MESSAGE } from "../src/services/http-errors.js";

test("production hardening keeps failures classified, throttled and bounded", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "scratch-hardening-test-"));
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: path.join(temporary, "no-env"),
    SCRATCH_DATA_ROOT: temporary,
    MONGODB_URI: "",
    AUTH_SECRET: "isolated-hardening-test-secret-value",
    SUPER_ADMIN_LOGIN_ID: "hardening-root",
    SUPER_ADMIN_PASSWORD: "Hardening-Root-Password",
    IMPACT_VIBES_EMAIL: "hardening-owner@example.test",
    IMPACT_VIBES_PASSWORD: "Hardening-Owner-Password",
  });
  for (const key of ["NETLIFY", "VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "RENDER", "TRUST_PROXY"])
    delete process.env[key];
  const { app, connectDatabase } = await import("../src/app/index.js");
  await connectDatabase();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const resolved = await fs.realpath(temporary);
    // Compare real paths: Windows can report TEMP as an 8.3 short name.
    assert.equal(resolved.toLowerCase(),
      path.join(await fs.realpath(os.tmpdir()), path.basename(temporary)).toLowerCase());
    assert.ok(path.basename(resolved).startsWith("scratch-hardening-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const request = async (url, { token, method = "GET", body, headers = {} } = {}) => {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, ...(text ? JSON.parse(text) : {}) };
  };
  const login = (loginId, password) => request("/api/auth/login", { method: "POST", body: { loginId, password } });
  const owner = (await login("hardening-owner@example.test", "Hardening-Owner-Password")).token;
  assert.ok(owner);
  const draft = {
    businessId: "impact-vibes", headline: "A surprise for you", offerTitle: "10% OFF",
    description: "On your next visit", customerPhone: "9876543210",
  };

  await t.test("unknown API routes and requests without a JSON body are client errors", async () => {
    const missing = await request("/api/does-not-exist");
    assert.equal(missing.status, 404);
    assert.equal(missing.message, "This API route does not exist.");
    assert.equal((await request("/api/auth/login", { method: "POST" })).status, 401);
    const plain = await request("/api/auth/login", { method: "POST", body: "loginId=x", headers: { "Content-Type": "text/plain" } });
    assert.equal(plain.status, 401);
  });

  await t.test("links and phone numbers are rejected as validation errors", async () => {
    const malformed = await request("/api/cards", { token: owner, method: "POST", body: { ...draft, claimUrl: "not a link" } });
    assert.equal(malformed.status, 400);
    assert.match(malformed.message, /http:\/\/ or https:\/\//);
    const protocol = await request("/api/cards", { token: owner, method: "POST", body: { ...draft, claimUrl: "ftp://example.test/offer" } });
    assert.equal(protocol.status, 400);
    assert.equal(protocol.message, "Claim link must use http or https.");
    const phone = await request("/api/cards", { token: owner, method: "POST", body: { ...draft, customerPhone: "call me" } });
    assert.equal(phone.status, 400);
    assert.match(phone.message, /WhatsApp number/);
  });

  await t.test("small files declaring enormous dimensions are refused before saving", async () => {
    const before = (await request("/api/portal/cards", { token: owner })).cards.length;
    const huge = await sharp({ create: { width: 10000, height: 5200, channels: 3, background: "#ffffff" } })
      .png({ compressionLevel: 9 }).toBuffer();
    assert.ok(huge.length < 5 * 1024 * 1024);
    const result = await request("/api/cards", { token: owner, method: "POST",
      body: { ...draft, shareImage: `data:image/png;base64,${huge.toString("base64")}` } });
    assert.equal(result.status, 400);
    assert.match(result.message, /50 megapixels/);
    assert.equal((await request("/api/portal/cards", { token: owner })).cards.length, before);
  });

  await t.test("bulk batches never copy a preview image into every coupon", async () => {
    const branch = (await request("/api/portal/businesses/impact-vibes/branches", { token: owner, method: "POST",
      body: { name: "Central" } })).branch;
    const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const batch = await request("/api/cards/bulk", { token: owner, method: "POST", body: {
      ...draft, customerPhone: "", branches: [{ branchId: branch.branchId, quantity: 3 }],
      idempotencyKey: "hardening-batch-key-0001", shareImage: `data:image/png;base64,${pixel}`,
    } });
    assert.equal(batch.status, 201, batch.message);
    assert.equal(batch.savedCount, 3);
    const stored = JSON.parse(await fs.readFile(path.join(temporary, "server/data/cards.json"), "utf8"))
      .filter((card) => card.batchKey === batch.batchId);
    assert.equal(stored.length, 3);
    for (const card of stored) {
      assert.equal(card.shareImageBase64, undefined);
      assert.equal(card.shareImageMime, undefined);
    }
  });

  await t.test("unexpected server failures return a generic 500 instead of internal details", async () => {
    const controlFile = path.join(temporary, "server/data/control.json");
    const original = await fs.readFile(controlFile, "utf8");
    await fs.writeFile(controlFile, "{ corrupted");
    try {
      const result = await request("/api/platform");
      assert.equal(result.status, 500);
      assert.equal(result.message, UNEXPECTED_ERROR_MESSAGE);
    } finally {
      await fs.writeFile(controlFile, original);
    }
    assert.equal((await request("/api/platform")).status, 200);
  });

  await t.test("failed sign-ins lock only the targeted login ID", async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      assert.equal((await login("hardening-owner@example.test", "wrong-password")).status, 401);
    const locked = await login("hardening-owner@example.test", "Hardening-Owner-Password");
    assert.equal(locked.status, 429);
    assert.match(locked.message, /Too many sign-in attempts/);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
    // Other people behind the same address are not locked out.
    const root = await login("hardening-root", "Hardening-Root-Password");
    assert.equal(root.status, 200, root.message);
    // A successful sign-in clears its own failures but never spends allowance.
    for (let attempt = 0; attempt < 3; attempt++)
      assert.equal((await login("hardening-root", "Hardening-Root-Password")).status, 200);
  });
});
