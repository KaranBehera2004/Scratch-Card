import test from "node:test";
import assert from "node:assert/strict";
import { ensureIndex, ensureUniqueIndex } from "../src/services/indexes.js";

const collection = (indexes) => {
  const created = [];
  return {
    created,
    listIndexes: () => ({ toArray: async () => indexes }),
    createIndex: async (key, options) => { created.push({ key, options }); return options.name; },
  };
};

test("startup reuses the existing unique_business_id index without recreating it", async () => {
  const stub = collection([{ name: "unique_business_id", key: { businessId: 1 }, unique: true }]);
  assert.equal(await ensureUniqueIndex(stub, "businessId", "businessId_1"), "unique_business_id");
  assert.deepEqual(stub.created, []);
});

test("matching indexes are reusable under any legacy name", async () => {
  for (const field of ["businessId", "couponCode", "key"]) {
    const stub = collection([{ name: "legacy_name", key: { [field]: 1 }, unique: true }]);
    assert.equal(await ensureUniqueIndex(stub, field, `unique_${field}`), "legacy_name");
    assert.deepEqual(stub.created, []);
  }
});

test("missing login indexes are created unique and sparse for legacy email accounts", async () => {
  const stub = collection([{ name: "_id_", key: { _id: 1 } }]);
  assert.equal(await ensureUniqueIndex(stub, "loginId", "unique_business_login_id", { sparse: true }), "unique_business_login_id");
  assert.deepEqual(stub.created, [{ key: { loginId: 1 }, options: { name: "unique_business_login_id", unique: true, sparse: true } }]);
});

test("existing sparse login index is reused without renaming", async () => {
  const stub = collection([{ name: "loginId_1", key: { loginId: 1 }, unique: true, sparse: true }]);
  assert.equal(await ensureUniqueIndex(stub, "loginId", "unique_business_login_id", { sparse: true }), "loginId_1");
  assert.deepEqual(stub.created, []);
});

test("new collections create missing indexes and unrelated errors propagate", async () => {
  const stub = collection([]);
  stub.listIndexes = () => ({ toArray: async () => { throw Object.assign(new Error("Missing collection"), { code: 26 }); } });
  await ensureUniqueIndex(stub, "businessId", "unique_business_id");
  assert.equal(stub.created.length, 1);
  const denied = new Error("Access denied");
  stub.listIndexes = () => ({ toArray: async () => { throw denied; } });
  await assert.rejects(ensureUniqueIndex(stub, "businessId", "unique_business_id"), denied);
});

test("concurrent equivalent index creation is handled without dropping indexes", async () => {
  let reads = 0;
  const stub = collection([]);
  stub.listIndexes = () => ({ toArray: async () => ++reads === 1 ? [] : [{ name: "other_server_name", key: { businessId: 1 }, unique: true }] });
  stub.createIndex = async () => { throw Object.assign(new Error("Index name conflict"), { code: 85 }); };
  assert.equal(await ensureUniqueIndex(stub, "businessId", "unique_business_id"), "other_server_name");
});

test("listing indexes reuse any index with the same key pattern", async () => {
  const stub = collection([{ name: "manual_business_listing", key: { businessId: 1, createdAt: -1 } }]);
  assert.equal(await ensureIndex(stub, { businessId: 1, createdAt: -1 }), "manual_business_listing");
  assert.deepEqual(stub.created, []);
});

test("listing indexes respect key order and direction", async () => {
  const stub = collection([{ name: "createdAt_1_businessId_1", key: { createdAt: 1, businessId: 1 } },
    { name: "businessId_1_createdAt_1", key: { businessId: 1, createdAt: 1 } }]);
  stub.createIndex = async (key) => { stub.created.push(key); return "businessId_1_createdAt_-1"; };
  assert.equal(await ensureIndex(stub, { businessId: 1, createdAt: -1 }), "businessId_1_createdAt_-1");
  assert.deepEqual(stub.created, [{ businessId: 1, createdAt: -1 }]);
});

test("listing indexes tolerate concurrent creation and report other failures", async () => {
  let reads = 0;
  const stub = collection([]);
  stub.listIndexes = () => ({ toArray: async () => ++reads === 1 ? [] : [{ name: "other_server", key: { createdAt: 1, _id: 1 } }] });
  stub.createIndex = async () => { throw Object.assign(new Error("Index already exists with a different name"), { code: 85 }); };
  assert.equal(await ensureIndex(stub, { createdAt: 1, _id: 1 }), "other_server");
  const denied = new Error("not authorized to create index");
  stub.listIndexes = () => ({ toArray: async () => [] });
  stub.createIndex = async () => { throw denied; };
  await assert.rejects(ensureIndex(stub, { createdAt: 1, _id: 1 }), denied);
});

test("incompatible indexes and duplicate data are not silently ignored", async () => {
  for (const options of [{}, { unique: true, sparse: true }, { unique: true, partialFilterExpression: { status: "active" } }, { unique: true, key: { businessId: 1, status: 1 } }]) {
    const stub = collection([{ name: "existing", key: { businessId: 1 }, ...options }]);
    const conflict = Object.assign(new Error("Incompatible index"), { code: 85 });
    stub.createIndex = async () => { throw conflict; };
    await assert.rejects(ensureUniqueIndex(stub, "businessId", "unique_business_id"), conflict);
  }
  const duplicate = Object.assign(new Error("Duplicate data"), { code: 11000 });
  const stub = collection([]);
  stub.createIndex = async () => { throw duplicate; };
  await assert.rejects(ensureUniqueIndex(stub, "businessId", "unique_business_id"), duplicate);
});
