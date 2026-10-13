import test from "node:test";
import assert from "node:assert/strict";
import { appOrigin, scratchApiUrl, scratchCardUrl, scratchShareUrl } from "./urls.js";
import { bulkExcelRows, shareExcelRows } from "../../client/src/features/bulk/bulk-coupons.js";

test("production shares use the app domain from custom, preview and legacy Vercel URLs", () => {
  for (const origin of [
    undefined,
    "https://scratch.justconnect.biz/",
    "https://api-scratch.justconnect.biz",
    "https://scratch-card-impact.vercel.app",
    "https://scratch-card-preview-123.vercel.app",
  ]) {
    assert.equal(scratchCardUrl("Abc123_-", origin), "https://scratch.justconnect.biz/card/Abc123_-");
    assert.equal(scratchShareUrl("Abc123_-", origin), "https://scratch.justconnect.biz/share/Abc123_-?v=5");
  }
});

test("local, LAN and separately hosted card links keep their own origin and port", () => {
  for (const origin of ["http://localhost:5174", "http://localhost:5175", "http://127.0.0.1:5099", "http://192.168.1.10:5174", "http://[::1]:5174", "https://example.test"]) {
    assert.equal(appOrigin(`${origin}/`), origin);
    assert.equal(scratchCardUrl("Abc123_-", origin), `${origin}/card/Abc123_-`);
    assert.equal(scratchShareUrl("Abc123_-", origin), `${origin}/card/Abc123_-`);
  }
  assert.equal(scratchCardUrl("a/b?c", "http://localhost:5174"), "http://localhost:5174/card/a%2Fb%3Fc");
});

test("production card API reads go to Render while local previews stay local", () => {
  for (const origin of [
    undefined,
    "https://scratch.justconnect.biz",
    "https://scratch-card-preview-123.vercel.app",
  ])
    assert.equal(scratchApiUrl("/api/cards/Abc123", origin),
      "https://api-scratch.justconnect.biz/api/cards/Abc123");
  assert.equal(scratchApiUrl("/api/cards/Abc123", "http://127.0.0.1:5099"),
    "http://127.0.0.1:5099/api/cards/Abc123");
});

test("bulk and WhatsApp Excel exports use production app links for every coupon", () => {
  const coupons = Array.from({ length: 30 }, (_, index) => ({ slug: `card${index}`, couponCode: `CODE-${index}`, customerPhone: "+919876543210" }));
  const origin = "https://scratch-card-impact.vercel.app";
  const bulk = bulkExcelRows(coupons, origin);
  const share = shareExcelRows(coupons, origin);
  for (let index = 0; index < coupons.length; index++) {
    const expected = `https://scratch.justconnect.biz/card/card${index}`;
    assert.deepEqual(bulk[index][5], { value: expected, type: String });
    assert.deepEqual(share[index][6], { value: expected, type: String, format: "@" });
  }
});
