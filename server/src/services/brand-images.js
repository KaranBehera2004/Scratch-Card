import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import sharp from "sharp";

const Asset = mongoose.model("BrandImage", new mongoose.Schema({
  _id: String, hash: String, data: Buffer, dataBase64: String,
}, { versionKey: false, autoIndex: false }));
const problem = message => Object.assign(new Error(message), { status: 400 });
const imageHash = data => crypto.createHash("sha256").update(data).digest("hex");

export function brandImageBytes(asset) {
  // New uploads use a stable text representation across Mongo driver versions.
  if (typeof asset?.dataBase64 === "string") return Buffer.from(asset.dataBase64, "base64");
  const data = asset?.data;
  if (!data) return null;
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (data._bsontype === "Binary" && typeof data.value === "function") return Buffer.from(data.value());
  // Never copy a typed array's entire backing allocation: it may also contain
  // unrelated BSON bytes, before or after the actual image view.
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data.type === "Buffer" && Array.isArray(data.data)) return Buffer.from(data.data);
  return null;
}

// Logos are validated, resized and stored once. Cards only snapshot their tiny
// immutable URL, not hundreds of copies of an uploaded image in a bulk batch.
export function brandImages(app, { dataDir, isMongo }) {
  const directory = path.join(dataDir, "brand-images");
  const readImage = async hash => {
    if (isMongo()) {
      // Read at the driver boundary because older assets use ObjectId + hash,
      // while the first content-addressed assets used the digest as _id.
      const options = { readPreference: "primary" };
      const asset = await Asset.collection.findOne({ _id: hash }, options)
        || await Asset.collection.findOne({ hash }, options);
      return brandImageBytes(asset);
    }
    try { return await fs.readFile(path.join(directory, `${hash}.webp`)); }
    catch (error) { if (error.code !== "ENOENT") throw error; return null; }
  };
  app.get("/api/brand-images/:hash", async (req, res, next) => {
    try {
      if (!/^[a-f0-9]{64}$/.test(req.params.hash)) return res.sendStatus(404);
      // Also supports earlier ObjectId records with a separate hash field.
      const data = await readImage(req.params.hash);
      if (!data) return res.sendStatus(404);
      res.set({ "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable" }).send(data);
    } catch (error) { next(error); }
  });
  // Store each processed image once by content hash and return its public URL.
  const persist = async (data) => {
    const hash = imageHash(data);
    if (isMongo()) {
      const update = { $set: { hash, dataBase64: data.toString("base64") }, $unset: { data: "" } };
      // The original collection has a unique `hash` index. Always populate
      // it: omitting it allowed one document with hash:null, then every
      // later logo hit a duplicate-key error. Support both historical
      // ObjectId+hash records and the temporary digest-as-_id format.
      let result = await Asset.collection.updateOne({ hash }, update);
      if (!result.matchedCount) {
        try { result = await Asset.collection.updateOne({ _id: hash }, update); }
        catch (error) {
          if (error.code !== 11000) throw error;
          result = await Asset.collection.updateOne({ hash }, update);
        }
      }
      if (!result.matchedCount) {
        try { await Asset.collection.updateOne({ hash }, update, { upsert: true }); }
        catch (error) {
          if (error.code !== 11000) throw error;
          await Asset.collection.updateOne({ hash }, update);
        }
      }
    }
    else {
      await fs.mkdir(directory, { recursive: true });
      if (!(await readImage(hash))?.equals(data)) {
        const destination = path.join(directory, `${hash}.webp`);
        const temporary = path.join(directory, `${hash}.${crypto.randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, data, { flag: "wx" });
          // Publish complete bytes at once. A simultaneous logo request
          // must never see a file truncated by an identical re-upload.
          await fs.rename(temporary, destination);
        } finally { await fs.rm(temporary, { force: true }); }
      }
    }
    const saved = await readImage(hash);
    // Verify against the fingerprint computed before persistence, not a
    // Buffer object that an adapter can reuse or change while serializing.
    if (!saved?.length || imageHash(saved) !== hash) throw Object.assign(new Error("The logo could not be read back correctly from storage. Please try saving again."), { status: 503 });
    return `/api/brand-images/${hash}`;
  };
  async function saveBrand(input, current = {}) {
    current ||= {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw problem("Enter a brand name and image.");
    if (input.name !== undefined && typeof input.name !== "string") throw problem("Enter a valid brand name.");
    const name = String(input.name ?? "").trim();
    if (name.length > 60) throw problem("Brand names can contain at most 60 characters.");
    if (!name && (input.image === undefined ? current.image : input.image)) throw problem("Enter a brand name before adding an image.");
    let image = current.image || "";
    if (input.image !== undefined && input.image !== image) {
      if (input.image === "") image = "";
      else {
        if (typeof input.image !== "string" || input.image.length > 2_800_000)
          throw problem("Choose a JPG, PNG or WebP brand image smaller than 2 MB.");
        const match = input.image.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) throw problem("Choose a JPG, PNG or WebP brand image.");
        const original = Buffer.from(match[1], "base64");
        if (original.length > 2 * 1024 * 1024) throw problem("Choose a brand image smaller than 2 MB.");
        let data;
        try {
          const source = sharp(original, { limitInputPixels: 16_000_000 });
          const metadata = await source.metadata();
          if (!["png", "jpeg", "webp"].includes(metadata.format)) throw new Error("format");
          // Remove transparent or single-colour padding commonly included in
          // exported logo files, so the actual mark fills its card header slot.
          let prepared = source.rotate();
          if ((metadata.width || 0) >= 3 && (metadata.height || 0) >= 3) prepared = prepared.trim({ threshold: 12 });
          data = await prepared.resize(320, 160, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
        } catch { throw problem("Choose a valid JPG, PNG or WebP image of at most 16 megapixels."); }
        image = await persist(data);
      }
    }
    if (image && !input.image?.startsWith("data:")) {
      const hash = image.match(/^\/api\/brand-images\/([a-f0-9]{64})$/)?.[1];
      const saved = hash && await readImage(hash);
      if (!saved?.length) throw problem("The saved brand image is missing. Choose the logo file again, or remove the image before saving.");
    }
    return { name, image };
  }
  // Scratch-layer cover artwork shares the content-addressed store, so a bulk
  // batch snapshots one small URL instead of copying the image into every card.
  saveBrand.saveScratchImage = async function saveScratchImage(input) {
    if (typeof input !== "string" || input.length > 2_800_000)
      throw problem("Choose a JPG, PNG or WebP scratch image smaller than 2 MB.");
    const match = input.match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw problem("Choose a JPG, PNG or WebP scratch image.");
    const original = Buffer.from(match[1], "base64");
    if (original.length > 2 * 1024 * 1024) throw problem("Choose a scratch image smaller than 2 MB.");
    let data;
    try {
      const source = sharp(original, { limitInputPixels: 16_000_000 });
      const metadata = await source.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format)) throw new Error("format");
      data = await source.rotate().resize(900, 500, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    } catch { throw problem("Choose a valid JPG, PNG or WebP image of at most 16 megapixels."); }
    return persist(data);
  };
  return saveBrand;
}
