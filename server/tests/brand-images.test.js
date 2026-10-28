import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import sharp from "sharp";
import { brandImages, brandImageBytes } from "../src/services/brand-images.js";

test("logo decoding preserves logical bytes, not BSON capacity or typed-array backing memory", () => {
  const bytes = Buffer.from("the exact logo bytes");
  const allocation = new Uint8Array(256).fill(99);
  allocation.set(bytes, 37);
  const view = allocation.subarray(37, 37 + bytes.length);
  const binary = new mongoose.mongo.Binary();
  binary.write(bytes);
  assert.ok(binary.buffer.length > bytes.length, "regression includes an oversized BSON backing allocation");
  for (const asset of [
    { data: bytes }, { data: view }, { data: binary },
    { data: { type: "Buffer", data: [...bytes] } },
    { dataBase64: bytes.toString("base64") },
  ]) assert.deepEqual(brandImageBytes(asset), bytes);
  assert.equal(brandImageBytes(null), null);
  assert.equal(brandImageBytes({ data: {} }), null);
});

test("real Mongoose casting round-trips logos, repairs uploads and reads legacy assets", async t => {
  const original = await sharp({ create: { width: 180, height: 90, channels: 4, background: "#006c96" } }).png().toBuffer();
  const second = await sharp({ create: { width: 170, height: 80, channels: 4, background: "#e59a00" } }).png().toBuffer();
  const app = express(), Asset = mongoose.model("BrandImage"), records = [], reads = [];
  const originalUpdate = Asset.collection.updateOne, originalFind = Asset.collection.findOne;
  let dropWrites = false;
  // Intercept only the driver boundary. Mongoose still casts every update and
  // executes real queries; the previous model-method mock skipped this path.
  const bsonClone = value => mongoose.mongo.BSON.deserialize(mongoose.mongo.BSON.serialize(value));
  const match = (row, query) => query._id !== undefined ? row._id === query._id : row.hash === query.hash;
  Asset.collection.updateOne = async (query, update, options = {}) => {
    let row = records.find(item => match(item, query));
    if (dropWrites) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    const matchedCount = row ? 1 : 0;
    if (!row && options.upsert) {
      row = { _id: new mongoose.Types.ObjectId(), ...(query.hash ? { hash: query.hash } : {}) };
      records.push(row);
    }
    if (row) {
      Object.assign(row, bsonClone(update.$set));
      for (const field of Object.keys(update.$unset || {})) delete row[field];
    }
    return { acknowledged: true, matchedCount, modifiedCount: row ? 1 : 0, upsertedCount: !matchedCount && row ? 1 : 0 };
  };
  Asset.collection.findOne = async (query, options) => {
    reads.push(options?.readPreference?.mode || options?.readPreference);
    const row = records.find(item => match(item, query));
    return row ? bsonClone(row) : null;
  };
  t.after(() => { Asset.collection.updateOne = originalUpdate; Asset.collection.findOne = originalFind; });
  const save = brandImages(app, { dataDir: "unused-mongo-image-directory", isMongo: () => true });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const input = { name: "Logo", image: `data:image/png;base64,${original.toString("base64")}` };
  const brand = await save(input);
  const hash = brand.image.split("/").at(-1), url = `http://127.0.0.1:${server.address().port}${brand.image}`;
  const stored = () => records.find(row => row.hash === hash);
  assert.equal(typeof stored().dataBase64, "string");
  assert.equal(stored().data, undefined);
  assert.equal(stored().hash, hash, "every upload populates the legacy unique hash field");
  const secondBrand = await save({ name: "Second logo", image: `data:image/png;base64,${second.toString("base64")}` });
  const secondHash = secondBrand.image.split("/").at(-1);
  assert.notEqual(secondHash, hash);
  assert.equal(records.filter(row => row.hash === secondHash).length, 1, "multiple different logos are stored independently");
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, Buffer.from(stored().dataBase64, "base64"));
  assert.equal((await sharp(bytes).metadata()).width, 180);
  records.splice(records.findIndex(row => row.hash === hash), 1, { _id: hash, hash, data: new mongoose.mongo.Binary(bytes) });
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), bytes, "existing binary records still load");
  records.splice(records.findIndex(row => row.hash === hash), 1, { _id: new mongoose.Types.ObjectId(), hash, data: new mongoose.mongo.Binary(bytes) });
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), bytes, "earlier ObjectId/hash records still load");
  assert.equal((await save(input, brand)).image, brand.image);
  stored().dataBase64 = Buffer.from("damaged image").toString("base64");
  assert.equal((await save(input, brand)).image, brand.image);
  assert.deepEqual(Buffer.from(stored().dataBase64, "base64"), bytes, "same-file upload repairs damaged data");
  assert.ok(reads.every(preference => preference === "primary"), "verification and logo reads use the primary");
  records.length = 0; dropWrites = true;
  await assert.rejects(save(input), /could not be read back correctly/);
  await assert.rejects(save({ name: "Missing", image: brand.image }, brand), /saved brand image is missing/);
  assert.equal((await fetch(url)).status, 404);
});
