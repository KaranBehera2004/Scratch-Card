import test from "node:test";
import assert from "node:assert/strict";
import { isProductionRuntime, parseClientOrigins, validateRuntimeConfiguration } from "../src/services/runtime-config.js";

const valid = {
  NODE_ENV: "production",
  MONGODB_URI: "mongodb+srv://example.invalid/database",
  AUTH_SECRET: "a-private-secret-with-at-least-32-characters",
  CLIENT_ORIGIN: "https://scratch.justconnect.biz",
};

test("production runtime detection includes Render and serverless hosts", () => {
  assert.equal(isProductionRuntime({}), false);
  assert.equal(isProductionRuntime({ NODE_ENV: "production" }), true);
  assert.equal(isProductionRuntime({ RENDER: "true" }), true);
  assert.equal(isProductionRuntime({ VERCEL: "1" }), true);
});

test("production refuses ephemeral storage and incomplete security configuration", () => {
  assert.throws(() => validateRuntimeConfiguration({ ...valid, MONGODB_URI: "" }), /MONGODB_URI/);
  assert.throws(() => validateRuntimeConfiguration({ ...valid, AUTH_SECRET: "short" }), /AUTH_SECRET/);
  assert.throws(() => validateRuntimeConfiguration({ ...valid, CLIENT_ORIGIN: "" }), /CLIENT_ORIGIN/);
  assert.throws(() => validateRuntimeConfiguration({ ...valid, CLIENT_ORIGIN: "https://example.com/path" }), /only HTTP/);
  assert.doesNotThrow(() => validateRuntimeConfiguration(valid));
  assert.doesNotThrow(() => validateRuntimeConfiguration({ NODE_ENV: "development" }));
});

test("client origins normalize trailing slashes and support explicit preview domains", () => {
  assert.deepEqual(parseClientOrigins("https://scratch.justconnect.biz/, https://preview.vercel.app"), [
    "https://scratch.justconnect.biz",
    "https://preview.vercel.app",
  ]);
  assert.throws(() => parseClientOrigins("https://example.com/path"), /only HTTP/);
});
