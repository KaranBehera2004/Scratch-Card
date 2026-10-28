import "dotenv/config";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import sharp from "sharp";
import { installControls } from "../routes/control.js";
import { errorMessage, errorStatus } from "../services/http-errors.js";
import { ensureIndex, ensureUniqueIndex } from "../services/indexes.js";
import { isProductionRuntime, parseClientOrigins, trustProxySetting, validateRuntimeConfiguration } from "../services/runtime-config.js";
import { normalizeWhatsAppNumber } from "../../shared/whatsapp.js";
import { PRODUCTION_APP_URL } from "../../shared/urls.js";
import { publicCardProblem } from "../../shared/public-card-errors.js";
import { publicCardErrorPage } from "../services/public-card-page.js";
import { brandImages } from "../services/brand-images.js";
import { installBulkRoutes, bad, couponStatus, checkCapacity } from "../routes/bulk.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rootDir = process.env.SCRATCH_DATA_ROOT || projectRoot;
const dataDir = path.join(rootDir, "server", "data");
const dataFile = path.join(dataDir, "cards.json");
const businessesFile = path.join(dataDir, "businesses.json");
validateRuntimeConfiguration();
export const app = express();
const port = Number(process.env.PORT) || 5051;

app.disable("x-powered-by");
app.set("trust proxy", trustProxySetting());
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self)");
  next();
});
const permittedOrigins = new Set([
  PRODUCTION_APP_URL,
  ...parseClientOrigins(process.env.CLIENT_ORIGIN || ""),
]);
app.use(cors({ origin(origin, callback) {
  if (!origin || !isProductionRuntime() || permittedOrigins.has(origin))
    return callback(null, true);
  return callback(Object.assign(new Error("This website origin is not allowed by CLIENT_ORIGIN."), { status: 403 }));
} }));
// API state must always be read from the database. Ignore browser/CDN
// validators so a newly created or claimed card can never receive a stale 304.
app.use("/api", (req, res, next) => {
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
  res.set({
    "Cache-Control": "private, no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
  next();
});
// Single-card requests may contain one bounded image used by WhatsApp's link
// preview. Bulk batches never carry images, and other API requests retain the
// smaller default parsing limit.
app.use("/api/cards/bulk", express.json({ limit: "1mb" }));
app.use("/api/cards", express.json({ limit: "8mb" }));
app.use("/api/portal/businesses/:businessId/brand-settings", express.json({ limit: "3mb" }));
app.use("/api/scratch-images", express.json({ limit: "3mb" }));
app.use(express.json({ limit: "256kb" }));
// Express 5 leaves req.body undefined without a JSON body. Handlers read
// optional fields directly, so give them an empty object instead of a TypeError.
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

const schema = new mongoose.Schema(
  {
    slug: { type: String, unique: true, index: true, required: true },
    senderName: { type: String, required: true, maxlength: 50 },
    shareTitle: { type: String, maxlength: 100, default: "Congratulation you got an offer" },
    headline: { type: String, required: true, maxlength: 80 },
    offerTitle: { type: String, required: true, maxlength: 30 },
    description: { type: String, required: true, maxlength: 80 },
    couponCode: { type: String, required: true, maxlength: 24 },
    customerPhone: { type: String, maxlength: 16, default: "" },
    claimUrl: { type: String, maxlength: 500, default: "" },
    accentColor: { type: String, default: "#ff9b72" },
    ticketColor: { type: String, default: "#ffd5bd" },
    ticketTextColor: { type: String, default: "#4b0024" },
    pageColor: { type: String, default: "#4b0024" },
    textColor: { type: String, default: "#fff8f5" },
    scratchColor: { type: String, default: "#b8c0ce" },
    scratchShineColor: { type: String, default: "#f8fafc" },
    scratchTextColor: { type: String, default: "#30394b" },
    scratchTitle: { type: String, maxlength: 40, default: "" },
    scratchSubtitle: { type: String, maxlength: 60, default: "" },
    scratchPattern: { type: Boolean, default: true },
    scratchImage: { type: String, default: "" },
    businessId: { type: String, default: "impact-vibes", index: true },
    branchId: { type: String, default: "" },
    branchName: { type: String, maxlength: 60 },
    displayBrandId: String,
    normalBrand: mongoose.Schema.Types.Mixed,
    fixedBrand: mongoose.Schema.Types.Mixed,
    centerBrand: mongoose.Schema.Types.Mixed,
    language: { type: String, enum: ["en", "hi", "te"], default: "en" },
    campaignName: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
    disabled: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: "" },
    openedAt: { type: Date, default: null },
    redeemedAt: { type: Date, default: null },
    scratchedAt: { type: Date, default: null },
    staffRedeemedAt: { type: Date, default: null },
    staffRedeemedBranchId: { type: String, default: "" },
    staffRedeemedDepartmentId: { type: String, default: "" },
    staffRedeemedBy: { type: String, default: "" },
    staffRedeemedByName: { type: String, default: "" },
    staffRedemptionMethod: { type: String, enum: ["", "manual", "qr"], default: "" },
    staffRedeemedBranchName: { type: String, default: "" },
    staffRedeemedLocationName: { type: String, default: "" },
    redeemedBranchId: { type: String, default: "" },
    batchKey: { type: String, index: true },
    batchFingerprint: String,
    shareImageMime: { type: String, enum: ["image/jpeg", "image/png", "image/webp"] },
    shareImageBase64: String,
  },
  { timestamps: true, versionKey: false, autoIndex: false },
);
const Card = mongoose.model("Card", schema);
const Business = mongoose.model(
  "Business",
  new mongoose.Schema(
    {
      planId: String,
      limits: mongoose.Schema.Types.Mixed,
      brand: mongoose.Schema.Types.Mixed,
      brandSettings: mongoose.Schema.Types.Mixed,
      structureMode: { type: String, enum: ["branch", "brand", "branch-only", "branch-department", "brand-department", "brand-only"] },
      cardImagesEnabled: Boolean,
      businessId: { type: String, unique: true },
      name: String,
      website: String,
      loginEmail: String,
      loginId: { type: String, unique: true, sparse: true },
      passwordHash: String,
      passwordVersion: { type: String, default: "" },
      status: { type: String, default: "active" },
      generationRevision: { type: Number, default: 0 },
      deletedAt: Date,
      departments: {
        type: [{ departmentId: String, name: String, image: String, status: String, deletedAt: Date }],
        default: [],
      },
      branches: {
        type: [
          { branchId: String, departmentId: String, name: String, address: String, status: String, deletedAt: Date },
        ],
        default: [],
      },
    },
    { timestamps: true, versionKey: false, autoIndex: false },
  ),
);
const CouponBatch = mongoose.model("CouponBatch", new mongoose.Schema({
  key: { type: String, required: true }, fingerprint: String, businessId: String,
  savedCount: Number,
}, { timestamps: true, versionKey: false, autoIndex: false }));
let atlasConnected = false;
let databasePromise = null;
let localCardQueue = Promise.resolve();
// The driver reconnects on its own. Logging these events explains brief
// 503 responses in the host logs instead of leaving them unexplained.
mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected; reconnecting automatically."));
mongoose.connection.on("reconnected", () => console.log("MongoDB reconnected."));
mongoose.connection.on("error", (error) => console.error("MongoDB connection error:", error.message));

const generateCouponCode = () =>
  `LUCKY-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
};
const verifyPassword = (password, stored) => {
  const [salt, saved] = String(stored || "").split(":");
  if (typeof password !== "string" || !salt || !saved) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return (
    actual.length === saved.length &&
    crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(saved))
  );
};
async function readBusinesses() {
  try {
    return JSON.parse(await fs.readFile(businessesFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function writeBusinesses(items) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(businessesFile, JSON.stringify(items, null, 2));
}
async function ensureImpactVibes() {
  const loginEmail = String(
    process.env.IMPACT_VIBES_EMAIL || "impactvibes@admin.local",
  ).toLowerCase();
  const password = String(process.env.IMPACT_VIBES_PASSWORD || "");
  if (atlasConnected) {
    const update = {
      $setOnInsert: {
        businessId: "impact-vibes",
        name: "Impact Vibes",
        website: "",
        status: "active",
      },
    };
    update.$setOnInsert.loginEmail = loginEmail;
    if (password) update.$setOnInsert.passwordHash = hashPassword(password);
    await Business.updateOne({ businessId: "impact-vibes" }, update, {
      upsert: true,
    });
    return;
  }
  const businesses = await readBusinesses();
  const existing = businesses.find(
    (item) => item.businessId === "impact-vibes",
  );
  if (!existing) {
    businesses.push({
      businessId: "impact-vibes",
      name: "Impact Vibes",
      website: "",
      loginEmail,
      passwordHash: password ? hashPassword(password) : "",
      status: "active",
    });
    await writeBusinesses(businesses);
  } else if (password && !existing.passwordHash) {
    existing.loginEmail = loginEmail;
    existing.passwordHash = hashPassword(password);
    await writeBusinesses(businesses);
  }
}
let businessesReadPromise = null;
async function listBusinesses() {
  if (businessesReadPromise) return businessesReadPromise;
  businessesReadPromise = Promise.resolve(atlasConnected
    ? Business.find({ status: { $ne: "deleted" } }).sort({ createdAt: -1 }).lean()
    : readBusinesses().then((items) => items.filter((business) => business.status !== "deleted")))
    .finally(() => { businessesReadPromise = null; });
  return businessesReadPromise;
}

export function connectDatabase() {
  if (atlasConnected && mongoose.connection.readyState === 1) return Promise.resolve();
  if (databasePromise) return databasePromise;

  databasePromise = initializeDatabase()
    .then(() => { databasePromise = null; })
    .catch((error) => {
      databasePromise = null;
      atlasConnected = false;
      throw error;
    });
  return databasePromise;
}

async function initializeDatabase() {
  validateRuntimeConfiguration();
  if (!process.env.MONGODB_URI) {
    await fs.mkdir(dataDir, { recursive: true });
    await normalizeLocalCoupons();
    await ensureImpactVibes();
    console.log("Storage: local JSON (add MONGODB_URI to use MongoDB Atlas)");
    return;
  }
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB || "scratch_cards",
    // Prefer IPv4 because several local/hosting networks expose an unusable
    // IPv6 route first, making every cold connection wait for a timeout.
    family: 4,
    // Atlas maintenance and failover elect a new primary in roughly 10–12
    // seconds. Wait that long instead of failing requests during routine events.
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 20,
    minPoolSize: isProductionRuntime() ? 1 : 0,
    maxIdleTimeMS: 60000,
  });
  // Dashboards list cards newest first, per business or across the platform.
  // Without these, every poll scans the whole collection and sorts it in memory.
  // They only speed up queries, so a failure must not stop the API starting.
  const listingIndexes = await Promise.allSettled([
    ensureIndex(Card.collection, { businessId: 1, createdAt: -1 }),
    ensureIndex(Card.collection, { createdAt: 1, _id: 1 }),
  ]);
  for (const result of listingIndexes)
    if (result.status === "rejected") console.warn("Card listing index unavailable:", result.reason?.message);
  await normalizeMongoCoupons();
  const ControlRecord = mongoose.model("ControlRecord");
  await Promise.all([
    ensureUniqueIndex(Card.collection, "couponCode", "unique_coupon_code"),
    ensureUniqueIndex(Card.collection, "slug", "unique_scratch_slug"),
    Card.collection.createIndex({ batchKey: 1 }),
    CouponBatch.init(),
    ControlRecord.init(),
    Business.init(),
  ]);
  await Promise.all([
    ensureUniqueIndex(CouponBatch.collection, "key", "unique_coupon_batch_key"),
    ensureUniqueIndex(ControlRecord.collection, "key", "unique_control_key"),
    ensureUniqueIndex(Business.collection, "businessId", "unique_business_id"),
    ensureUniqueIndex(Business.collection, "loginId", "unique_business_login_id", { sparse: true }),
    Card.updateMany({ redeemedAt: { $ne: null }, scratchedAt: null }, [
      { $set: { scratchedAt: "$redeemedAt" } },
    ]),
  ]);
  atlasConnected = true;
  await ensureImpactVibes();
  console.log("Storage: MongoDB Atlas");
}

async function readLocalCards() {
  try {
    return JSON.parse(await fs.readFile(dataFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function mutateLocalCards(mutate) {
  const run = localCardQueue.then(async () => {
    const cards = await readLocalCards(),
      result = mutate(cards);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(`${dataFile}.tmp`, JSON.stringify(cards, null, 2));
    await fs.rename(`${dataFile}.tmp`, dataFile);
    return result;
  });
  localCardQueue = run.catch(() => {});
  return run;
}
async function normalizeLocalCoupons() {
  const cards = await readLocalCards();
  const usedCodes = new Set();
  let changed = false;
  for (const card of cards) {
    // A historically redeemed coupon must remain revealed as well.
    if (card.redeemedAt && !card.scratchedAt) {
      card.scratchedAt = card.redeemedAt;
      changed = true;
    }
    let code = clean(card.couponCode, 24).toUpperCase();
    while (!code || usedCodes.has(code)) {
      code = generateCouponCode();
      changed = true;
    }
    if (card.couponCode !== code) {
      card.couponCode = code;
      changed = true;
    }
    usedCodes.add(code);
  }
  if (changed) await fs.writeFile(dataFile, JSON.stringify(cards, null, 2));
}
// Codes are saved trimmed and uppercase, and the unique index rejects
// duplicates. Once it exists, only a legacy code needing repair justifies
// reading every card during startup.
async function couponCodesNeedRepair() {
  const indexes = await Card.collection.indexes().catch(() => []);
  const unique = indexes.some((index) => index.unique && !index.sparse && !index.partialFilterExpression
    && Object.keys(index.key).length === 1 && index.key.couponCode === 1);
  if (!unique) return true;
  return Boolean(await Card.exists({ $or: [
    { couponCode: null }, { couponCode: "" }, { couponCode: /[a-z]|^\s|\s$|^[\s\S]{25}/ },
  ] }));
}
async function normalizeMongoCoupons() {
  if (!(await couponCodesNeedRepair())) return;
  // Startup only needs identifiers and coupon codes. Some cards contain large
  // WhatsApp preview images, so loading complete documents here made every
  // local restart download the entire card collection before the API listened.
  const cards = await Card.find({}, { couponCode: 1 })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const usedCodes = new Set();
  for (const card of cards) {
    let code = clean(card.couponCode, 24).toUpperCase();
    while (!code || usedCodes.has(code)) code = generateCouponCode();
    if (card.couponCode !== code)
      await Card.updateOne({ _id: card._id }, { $set: { couponCode: code } });
    usedCodes.add(code);
  }
}
async function findCard(slug, { includeImage = false } = {}) {
  return atlasConnected
    ? Card.findOne({ slug, deletedAt: null }).select(includeImage ? "+shareImageBase64" : "-shareImageBase64").lean()
    : (await readLocalCards()).find((card) => card.slug === slug && !card.deletedAt);
}
async function markCardOpened(card) {
  if (card.openedAt) return card;
  const openedAt = new Date();
  if (atlasConnected) {
    const updated = await Card.findOneAndUpdate(
      { slug: card.slug, openedAt: null },
      { $set: { openedAt } },
      { new: true },
    ).select("-shareImageBase64").lean();
    return updated || { ...card, openedAt };
  }
  return mutateLocalCards((cards) => {
    const current = cards.find((item) => item.slug === card.slug);
    if (!current) return card;
    if (!current.openedAt) current.openedAt = openedAt.toISOString();
    return { ...current };
  });
}
async function findRedeemedCoupons() {
  if (atlasConnected) {
    return Card.find({ redeemedAt: { $ne: null } })
      .select("slug couponCode offerTitle senderName businessId branchId redeemedAt")
      .sort({ redeemedAt: -1 })
      .lean();
  }
  return (await readLocalCards())
    .filter((card) => card.redeemedAt)
    .sort((a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt))
    .map(({ slug, couponCode, offerTitle, senderName, businessId, branchId, redeemedAt }) => ({
      slug,
      couponCode,
      offerTitle,
      senderName,
      businessId: businessId || "impact-vibes",
      branchId: branchId || "",
      redeemedAt,
    }));
}
async function findAllCoupons() {
  const visibleBusinesses = new Set((await listBusinesses()).map((business) => business.businessId));
  const cards = atlasConnected
    ? await Card.find()
        .select(
          "slug couponCode offerTitle senderName businessId branchId customerPhone expiresAt createdAt redeemedAt staffRedeemedAt deletedAt",
        )
        .sort({ createdAt: -1 })
        .lean()
    : (await readLocalCards()).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      );
  return cards.filter((card) => visibleBusinesses.has(card.businessId || "impact-vibes")).map(
    ({
      slug,
      couponCode,
      offerTitle,
      senderName,
      businessId,
      branchId,
      customerPhone,
      expiresAt,
      createdAt,
      redeemedAt,
      staffRedeemedAt,
      deletedAt,
    }) => ({
      slug,
      couponCode,
      offerTitle,
      senderName,
      businessId: businessId || "impact-vibes",
      branchId: branchId || "",
      customerPhone: customerPhone || "",
      expiresAt: expiresAt || null,
      createdAt,
      redeemedAt: redeemedAt || null,
      staffRedeemedAt: staffRedeemedAt || null,
      deletedAt: deletedAt || null,
      used: Boolean(staffRedeemedAt),
    }),
  );
}
async function claimLocalCard(slug) {
  return mutateLocalCards((cards) => {
    const index = cards.findIndex((card) => card.slug === slug);
    if (index === -1 || cards[index].deletedAt) return { status: "missing" };
    if (cards[index].redeemedAt || cards[index].scratchedAt) return { status: "used" };
    if (
      cards[index].disabled ||
      (cards[index].expiresAt && new Date(cards[index].expiresAt) <= new Date())
    )
      return { status: "unavailable" };
    const scratchedAt = new Date().toISOString();
    cards[index].scratchedAt = scratchedAt;
    return { status: "claimed", card: cards[index] };
  });
}
async function claimCard(slug) {
  if (!atlasConnected) return claimLocalCard(slug);
  const scratchedAt = new Date();
  const card = await Card.findOneAndUpdate(
    {
      slug,
      deletedAt: null,
      disabled: { $ne: true },
      redeemedAt: null,
      scratchedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: scratchedAt } }],
    },
    { $set: { scratchedAt } },
    { new: true },
  ).select("-shareImageBase64").lean();
  if (card) return { status: "claimed", card };
  const existing = await Card.findOne({ slug }).select("-shareImageBase64").lean();
  return {
    status: !existing || existing.deletedAt
      ? "missing"
      : existing.redeemedAt || existing.scratchedAt
        ? "used"
        : "unavailable",
  };
}
function publicCard(card) {
  // Explicitly allow presentation fields only. Customer contact details are private.
  const fields = ["slug", "senderName", "shareTitle", "headline", "offerTitle", "description",
    "claimUrl", "accentColor", "pageColor", "textColor", "ticketColor", "ticketTextColor", "businessId",
    "scratchColor", "scratchShineColor", "scratchTextColor", "scratchTitle", "scratchSubtitle",
    "scratchPattern", "scratchImage",
    "branchId", "branchName", "language", "campaignName", "expiresAt", "createdAt", "normalBrand", "fixedBrand", "centerBrand"];
  const revealed = Boolean(card.redeemedAt || card.scratchedAt);
  return {
    ...Object.fromEntries(fields.map((key) => [key, card[key]])),
    used: revealed,
    openedAt: card.openedAt || null,
    scratchedAt: card.scratchedAt || null,
    redeemed: Boolean(card.staffRedeemedAt),
    // Reveal the code after scratching, but remove it permanently from the
    // public response once branch staff has redeemed the coupon.
    ...(revealed && !card.staffRedeemedAt ? { couponCode: card.couponCode } : {}),
    hasShareImage: Boolean(card.shareImageBase64),
  };
}
const clean = (value, max) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const safeUrl = (value) => {
  const raw = clean(value, 500);
  if (!raw) return "";
  let parsed;
  try { parsed = new URL(raw); }
  catch { throw bad("Enter a complete link starting with http:// or https://."); }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw bad("Claim link must use http or https.");
  return parsed.toString();
};
const whatsAppNumber = (value) => {
  try { return normalizeWhatsAppNumber(value); }
  catch (error) { throw bad(error.message); }
};
const MAX_SHARE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SHARE_IMAGE_PIXELS = 50_000_000;
const SHARE_PREVIEW_VERSION = "5";
const SHARE_PREVIEW_WIDTH = 1200;
const SHARE_PREVIEW_HEIGHT = 630;
// Each preview renders a different stored image, so libvips' operation cache
// would only hold memory on a small hosting instance.
sharp.cache(false);
function safeShareImage(value) {
  if (value == null || value === "") return {};
  if (typeof value !== "string" || value.length > Math.ceil(MAX_SHARE_IMAGE_BYTES * 4 / 3) + 128)
    throw bad("Choose a JPG, PNG or WebP image smaller than 5 MB.");
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw bad("Choose a valid JPG, PNG or WebP image.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_SHARE_IMAGE_BYTES || buffer.toString("base64") !== match[2])
    throw bad("Choose a valid JPG, PNG or WebP image smaller than 5 MB.");
  const validSignature = match[1] === "image/png"
    ? buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    : match[1] === "image/jpeg"
      ? buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
      : buffer.subarray(0, 4).toString("ascii") === "RIFF"
        && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (!validSignature) throw bad("The uploaded file does not contain a valid JPG, PNG or WebP image.");
  return { shareImageMime: match[1], shareImageBase64: match[2] };
}
// Previews are rendered from the stored original on demand. A small file can
// still declare enormous dimensions, turning every render into a slow,
// memory-heavy job, so check the header before saving.
async function checkShareImageDimensions(base64) {
  if (!base64) return;
  let metadata;
  try { metadata = await sharp(Buffer.from(base64, "base64")).metadata(); }
  catch { throw bad("The uploaded file does not contain a valid JPG, PNG or WebP image."); }
  if (!metadata.width || !metadata.height)
    throw bad("The uploaded file does not contain a valid JPG, PNG or WebP image.");
  if (metadata.width * metadata.height > MAX_SHARE_IMAGE_PIXELS)
    throw bad("Choose an image of at most 50 megapixels (for example 8000 × 6000 pixels).");
}
const html = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const saveBrand = brandImages(app, { dataDir, isMongo: () => atlasConnected });
const { authenticate, audit, validateCreate, getBusiness, businessLimits, cardRows, scope, resolveRedemptionRecord } = installControls(
  app,
  {
    Business,
    Card,
    CouponBatch,
    listBusinesses,
    readBusinesses,
    writeBusinesses,
    readLocalCards,
    mutateLocalCards,
    dataDir,
    dataFile,
    isMongo: () => atlasConnected,
    hashPassword,
    verifyPassword,
    safeUrl,
    saveBrand,
  },
);

function cardLogoScale(value, label) {
  if (value === undefined || value === null || value === "") return 100;
  const scale = Number(value);
  if (!Number.isInteger(scale) || scale < 60 || scale > 140 || scale % 5)
    throw bad(`${label} logo size must be between 60% and 140%.`);
  return scale;
}

// Dragged header image positions, as a percentage of the image's own box.
function cardLogoOffset(value, label) {
  if (value === undefined || value === null || value === "") return 0;
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < -150 || offset > 150)
    throw bad(`${label} image position is outside the card header.`);
  return offset;
}
const logoOffset = (x, y) => x || y ? { offsetX: x, offsetY: y } : {};

function buildCard(body, business, bulk = false, allowExpired = false) {
  if (["branch-only", "brand-only"].includes(business.structureMode) && body.displayBrandId)
    throw bad("This workspace uses one structure level. Select a branch or brand only.");
  if (body.displayBrandId && (typeof body.displayBrandId !== "string" || (!allowExpired
      && !business.departments?.some(item => item.departmentId === body.displayBrandId && item.status === "active"))))
    throw bad("Choose an active brand from this business.");
  if (body.language !== undefined && !["en", "hi", "te"].includes(body.language))
    throw bad("Choose English, Hindi or Telugu for the card language.");
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || (!allowExpired && expiresAt <= new Date())))
    throw bad("Choose an expiry date in the future.");
  const card = {
    ...(body.displayBrandId ? { displayBrandId: body.displayBrandId } : {}),
    senderName: clean(business.name, 50), businessId: business.businessId,
    language: body.language || "en",
    shareTitle: clean(body.shareTitle, 100) || "Congratulation you got an offer",
    headline: clean(body.headline, 80),
    offerTitle: clean(body.offerTitle, 30), description: clean(body.description, 80),
    customerPhone: bulk && (body.customerPhone == null || (typeof body.customerPhone === "string" && !body.customerPhone.trim()))
      ? "" : whatsAppNumber(body.customerPhone),
    claimUrl: safeUrl(body.claimUrl), campaignName: clean(body.campaignName, 80), expiresAt,
    disabled: false, openedAt: null, redeemedAt: null, scratchedAt: null,
    staffRedeemedAt: null, staffRedeemedBranchId: "",
    staffRedeemedDepartmentId: "", staffRedeemedBy: "", staffRedeemedByName: "", staffRedemptionMethod: "",
    normalLogoScale: cardLogoScale(body.normalLogoScale, "Selected brand"),
    fixedLogoScale: cardLogoScale(body.fixedLogoScale, "Fixed brand"),
    centerLogoScale: cardLogoScale(body.centerLogoScale, "Middle"),
    ...Object.fromEntries([["normalLogoX", "Selected brand"], ["normalLogoY", "Selected brand"],
      ["centerLogoX", "Middle"], ["centerLogoY", "Middle"], ["fixedLogoX", "Fixed brand"], ["fixedLogoY", "Fixed brand"]]
      .map(([key, label]) => [key, cardLogoOffset(body[key], label)])),
    ...safeShareImage(body.shareImage),
    ...Object.fromEntries([["accentColor", "#ff9b72"], ["pageColor", "#4b0024"], ["textColor", "#fff8f5"], ["ticketColor", "#ffd5bd"], ["ticketTextColor", "#4b0024"]]
      .map(([key, fallback]) => [key, /^#[0-9a-f]{6}$/i.test(body[key]) ? body[key] : fallback])),
    ...Object.fromEntries([["scratchColor", "#b8c0ce"], ["scratchShineColor", "#f8fafc"], ["scratchTextColor", "#30394b"]]
      .map(([key, fallback]) => [key, /^#[0-9a-f]{6}$/i.test(body[key]) ? body[key] : fallback])),
    scratchTitle: clean(body.scratchTitle, 40), scratchSubtitle: clean(body.scratchSubtitle, 60),
    scratchPattern: body.scratchPattern !== false,
    // Only a URL returned by the scratch-image upload, never arbitrary image hosts.
    scratchImage: /^\/api\/brand-images\/[a-f0-9]{64}$/.test(body.scratchImage || "") ? body.scratchImage : "",
  };
  if (!card.senderName || !card.headline || !card.offerTitle || !card.description)
    throw bad("Please complete all required fields.");
  return card;
}
const batchCard = (card) => Object.fromEntries([
  "slug", "branchId", "branchName", "couponCode", "offerTitle", "description",
  "campaignName", "expiresAt", "createdAt", "openedAt", "scratchedAt", "redeemedAt", "staffRedeemedAt",
  "staffRedeemedBranchId", "staffRedeemedDepartmentId", "customerPhone", "deletedAt",
  "displayBrandId", "normalBrand", "fixedBrand", "centerBrand",
].map((key) => [key, card[key] ?? null]));
function batchResult(key, fingerprint, cards, replayed = false) {
  return { batchId: key, fingerprint, savedCount: cards.length, replayed,
    coupons: cards.map((card) => ({ ...batchCard(card), status: couponStatus(card) })) };
}
async function findBatch(key) {
  if (atlasConnected) {
    const batch = await CouponBatch.findOne({ key }).lean();
    if (!batch) return null;
    return batchResult(key, batch.fingerprint, await Card.find({ batchKey: key })
      .select("-shareImageBase64").sort({ createdAt: 1, _id: 1 }).lean());
  }
  const cards = (await readLocalCards()).filter((card) => card.batchKey === key);
  return cards.length ? batchResult(key, cards[0].batchFingerprint, cards) : null;
}
async function saveGeneration({ base, branches, total, maximum, batchKey, fingerprint, recipients = null, requestedCode = "" }) {
  const brandBusiness = await getBusiness(base.businessId);
  const fixedBrand = brandBusiness.brandSettings?.fixed || null;
  const centerBrand = brandBusiness.brandSettings?.center || null;
  const showCardImages = brandBusiness.cardImagesEnabled !== false;
  if (base.displayBrandId && !brandBusiness.departments?.some(item => item.departmentId === base.displayBrandId && item.status === "active"))
    throw bad("The selected brand is no longer active. No coupons were saved.");
  const makeCards = (existing = []) => {
    const { normalLogoScale = 100, fixedLogoScale = 100, centerLogoScale = 100, normalLogoX = 0, normalLogoY = 0,
      centerLogoX = 0, centerLogoY = 0, fixedLogoX = 0, fixedLogoY = 0, ...cardBase } = base;
    const codes = new Set(existing.map((card) => card.couponCode)), slugs = new Set(existing.map((card) => card.slug));
    if (requestedCode && codes.has(requestedCode)) throw bad("This coupon code already exists. Choose another code or leave it blank.", 409);
    const cards = [], createdAt = new Date().toISOString();
    const recipientsByBranch = recipients && new Map(branches.map((branch) => [branch.branchId,
      recipients.filter((recipient) => recipient.branchId === branch.branchId)]));
    for (const branch of branches) for (let index = 0; index < branch.quantity; index++) {
      let couponCode = requestedCode || generateCouponCode(), slug;
      while (codes.has(couponCode)) couponCode = generateCouponCode();
      do { slug = crypto.randomBytes(6).toString("base64url"); } while (slugs.has(slug));
      codes.add(couponCode); slugs.add(slug);
      const unit = brandBusiness.branches?.find(item => item.branchId === branch.branchId);
      const brand = brandBusiness.departments?.find(item => item.departmentId === (base.displayBrandId || unit?.departmentId) && item.status === "active");
      cards.push({ ...cardBase,
        normalBrand: brand ? { name: brand.name, image: showCardImages ? brand.image || "" : "",
          ...(normalLogoScale !== 100 ? { logoScale: normalLogoScale } : {}), ...logoOffset(normalLogoX, normalLogoY) } : null,
        fixedBrand: fixedBrand?.name ? { name: fixedBrand.name, image: showCardImages ? fixedBrand.image || "" : "",
          ...(fixedLogoScale !== 100 ? { logoScale: fixedLogoScale } : {}), ...logoOffset(fixedLogoX, fixedLogoY) } : null,
        centerBrand: centerBrand?.name ? { name: centerBrand.name, image: showCardImages ? centerBrand.image || "" : "",
          ...(centerLogoScale !== 100 ? { logoScale: centerLogoScale } : {}), ...logoOffset(centerLogoX, centerLogoY) } : null,
        branchId: branch.branchId, branchName: clean(branch.branchName, 60), slug, couponCode, createdAt,
        ...(recipientsByBranch ? { customerPhone: recipientsByBranch.get(branch.branchId)[index].customerPhone } : {}),
        ...(batchKey ? { batchKey, batchFingerprint: fingerprint } : {}) });
    }
    return cards;
  };
  const replay = (cards) => {
    if (cards[0].batchFingerprint !== fingerprint) throw bad("This retry key belongs to different batch details.", 409);
    return batchResult(batchKey, fingerprint, cards, true);
  };
  if (!atlasConnected) return mutateLocalCards((existing) => {
    const previous = batchKey && existing.filter((card) => card.batchKey === batchKey);
    if (previous?.length) return replay(previous);
    checkCapacity(existing, base.businessId, total, maximum);
    const cards = makeCards(existing);
    existing.push(...cards);
    return batchResult(batchKey, fingerprint, cards);
  });
  // Both single and bulk creation write the same business document before
  // counting capacity. MongoDB retries write conflicts to serialize creators.
  for (let attempt = 0; attempt < 5; attempt++) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        if (batchKey) {
          const prior = await CouponBatch.findOne({ key: batchKey }).session(session).lean();
          if (prior) {
            const cards = await Card.find({ batchKey }).select("-shareImageBase64")
              .sort({ createdAt: 1, _id: 1 }).session(session).lean();
            result = replay(cards);
            return;
          }
        }
        const current = await Business.findOneAndUpdate(
          { businessId: base.businessId, status: "active" }, { $inc: { generationRevision: 1 } },
          { new: true, session },
        ).lean();
        if (!current) throw bad("This business is paused or unavailable.", 403);
        if (branches.some((row) => row.branchId && !current.branches.some((branch) => branch.branchId === row.branchId && branch.status === "active")))
          throw bad("A selected branch is no longer active. No coupons were saved.");
        const query = base.businessId === "impact-vibes"
          ? { $or: [{ businessId: base.businessId }, { businessId: { $exists: false } }] }
          : { businessId: base.businessId };
        const count = await Card.countDocuments(query).session(session);
        const capacity = (await businessLimits(current)).card;
        if (capacity > 0 && count + total > capacity)
          throw bad(`This business has ${Math.max(0, capacity - count)} cards remaining. Requested ${total}.`, 403);
        const cards = await Card.insertMany(makeCards(), { session, ordered: true });
        if (batchKey) await CouponBatch.create([{ key: batchKey, fingerprint, businessId: base.businessId, savedCount: cards.length }], { session });
        result = batchResult(batchKey, fingerprint, cards);
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      return result;
    } catch (error) {
      if (error.code !== 11000) throw error;
      const previous = batchKey && await findBatch(batchKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw bad("This retry key belongs to different batch details.", 409);
        return { ...previous, replayed: true };
      }
      if (requestedCode) throw bad("This coupon code already exists. Choose another code or leave it blank.", 409);
      if (attempt === 4) throw bad("Could not allocate unique coupons. No coupons were saved; retry this batch.", 503);
    } finally { await session.endSession(); }
  }
}
installBulkRoutes(app, { authenticate, validateCreate, businessLimits, buildCard, saveGeneration, findBatch, audit, scope, getBusiness });

app.post("/api/portal/redeem", authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== "branch-staff")
      throw bad("Only branch staff can redeem customer coupons.", 403);
    const couponCode = clean(req.body.couponCode, 24).toUpperCase();
    if (!couponCode) throw bad("Enter the customer's coupon code.");
    // Older clients did not send a method; leave it unknown instead of guessing.
    const redemptionMethod = req.body.redemptionMethod ?? "";
    if (!["", "manual", "qr"].includes(redemptionMethod))
      throw bad("Choose a valid redemption method.");
    const businessId = req.user.businessId, branchId = req.user.branchId;
    const business = await getBusiness(businessId);
    const staffBranch = business.branches?.find((item) => item.branchId === branchId && item.status === "active");
    if (!staffBranch) throw bad("Your assigned branch is not active.", 403);
    // Storage calls Sales/Service units branches and their locations departments.
    const departmentName = (value) => String(value || "").trim().toLowerCase();
    const activeLocation = (unit) => !unit.departmentId || business.departments?.some((location) =>
      location.departmentId === unit.departmentId && (location.status || "active") === "active");
    if (!activeLocation(staffBranch)) throw bad("Your assigned branch's department is not active.", 403);
    // An unassigned coupon means "All departments" within this business.
    // null also matches older MongoDB records with a missing branchId.
    const eligibleBranchIds = ["", null, ...business.branches.filter((unit) => unit.status === "active"
      && activeLocation(unit) && departmentName(unit.name)
      && departmentName(unit.name) === departmentName(staffBranch.name)).map((unit) => unit.branchId)];
    const locationName = (unit) => business.departments?.find((location) =>
      location.departmentId === unit?.departmentId)?.name || "";
    const redemptionAt = new Date();
    const redemption = {
      staffRedeemedAt: redemptionAt,
      staffRedeemedBranchId: branchId,
      staffRedeemedDepartmentId: staffBranch.departmentId || "",
      staffRedeemedBy: req.user.id,
      staffRedeemedByName: req.user.name,
      staffRedemptionMethod: redemptionMethod,
      staffRedeemedBranchName: staffBranch.name,
      staffRedeemedLocationName: locationName(staffBranch),
      redeemedAt: redemptionAt,
      redeemedBranchId: branchId,
    };
    let redeemed;
    if (atlasConnected) {
      redeemed = await Card.findOneAndUpdate(
        {
          businessId,
          branchId: { $in: eligibleBranchIds },
          couponCode,
          deletedAt: null,
          scratchedAt: { $ne: null },
          staffRedeemedAt: null,
          disabled: { $ne: true },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: redemptionAt } }],
        },
        { $set: redemption },
        { new: true },
      ).select("-shareImageBase64").lean();
    } else {
      redeemed = await mutateLocalCards((cards) => {
        const card = cards.find((item) =>
          (item.businessId || "impact-vibes") === businessId
          && eligibleBranchIds.includes(String(item.branchId || ""))
          && String(item.couponCode || "").toUpperCase() === couponCode);
        if (!card || card.deletedAt || card.disabled || !card.scratchedAt || card.staffRedeemedAt
          || (card.expiresAt && new Date(card.expiresAt) <= redemptionAt)) return null;
        Object.assign(card, { ...redemption, staffRedeemedAt: redemption.staffRedeemedAt.toISOString() });
        return { ...card };
      });
    }
    if (!redeemed) {
      const card = atlasConnected
        ? await Card.findOne({ businessId, couponCode }).select("-shareImageBase64").lean()
        : (await readLocalCards()).find((item) =>
          (item.businessId || "impact-vibes") === businessId
          && String(item.couponCode || "").toUpperCase() === couponCode);
      if (!card || card.deletedAt) throw bad("Coupon code not found for this business.", 404);
      if (!eligibleBranchIds.includes(String(card.branchId || ""))) {
        const assignedBranch = business.branches?.find((item) => item.branchId === card.branchId);
        const completed = card.staffRedeemedAt ? await resolveRedemptionRecord(card) : null;
        const completedBranch = completed
          ? business.branches?.find((item) => item.branchId === completed.branchId)
          : null;
        const error = bad("This coupon is assigned to another branch and cannot be redeemed here.", 403);
        error.details = {
          couponCode: card.couponCode,
          redemptionStatus: card.staffRedeemedAt ? "Redeemed" : "Not redeemed",
          assignedBranchName: assignedBranch?.name || card.branchName || "Unknown branch",
          assignedLocationName: locationName(assignedBranch),
          ...(card.staffRedeemedAt ? {
            redeemedBranchName: completed.branchName || completedBranch?.name || "Unknown branch",
            redeemedLocationName: completed.locationName || locationName(completedBranch),
            staffName: completed.staffName,
            redeemedAt: completed.redeemedAt,
          } : {}),
        };
        throw error;
      }
      if (card.staffRedeemedAt) {
        const completed = await resolveRedemptionRecord(card);
        const completedBranch = business.branches?.find((item) => item.branchId === completed.branchId);
        const assignedBranch = business.branches?.find((item) => item.branchId === card.branchId);
        const error = bad(`This coupon has already been redeemed${completedBranch ? ` at ${completedBranch.name}` : ""}.`, 409);
        error.details = {
          couponCode: card.couponCode,
          redemptionStatus: "Redeemed",
          assignedBranchName: assignedBranch?.name || card.branchName || "Unknown branch",
          assignedLocationName: locationName(assignedBranch),
          redeemedBranchName: completed.branchName || completedBranch?.name || "Unknown branch",
          redeemedLocationName: completed.locationName || locationName(completedBranch),
          staffName: completed.staffName,
          redeemedAt: completed.redeemedAt,
        };
        throw error;
      }
      if (card.expiresAt && new Date(card.expiresAt) <= redemptionAt) throw bad("This coupon has expired.", 410);
      if (!card.scratchedAt) throw bad("The customer must scratch this card before it can be redeemed.", 409);
      if (card.disabled) throw bad("This coupon is disabled.", 410);
      throw bad("This coupon could not be redeemed. Refresh and try again.", 409);
    }
    const assignedBranch = business.branches?.find((item) => item.branchId === redeemed.branchId);
    await audit(req, "Coupon redeemed by branch staff", businessId,
      `${redeemed.couponCode} · ${staffBranch.name}`, {
        slug: redeemed.slug, branchId, locationId: staffBranch.departmentId || "",
        branchName: staffBranch.name, locationName: locationName(staffBranch),
        staffId: req.user.id, staffName: req.user.name, redeemedAt: redemptionAt.toISOString(),
        redemptionMethod,
      });
    res.set("Cache-Control", "no-store").json({
      coupon: {
        couponCode: redeemed.couponCode,
        offerTitle: redeemed.offerTitle,
        redemptionStatus: "Redeemed",
        assignedBranchName: assignedBranch?.name || redeemed.branchName || "Unknown branch",
        assignedLocationName: locationName(assignedBranch),
        redeemedBranchName: staffBranch.name,
        redeemedLocationName: locationName(staffBranch),
        staffName: req.user.name,
        redeemedAt: redeemed.staffRedeemedAt,
        redemptionMethod: redeemed.staffRedemptionMethod,
        status: "redeemed",
      },
    });
  } catch (error) { next(error); }
});

app.post("/api/portal/cards/:slug/redeem", authenticate, async (req, res, next) => {
  try {
    if (["viewer", "branch-staff"].includes(req.user.role)) throw bad("This account cannot redeem coupons.", 403);
    const card = (await cardRows(req)).find((item) => item.slug === req.params.slug);
    if (!card) throw bad("Card not found.", 404);
    // Business dashboards cannot consume coupons; branch staff verify and redeem by code.
    throw bad("Coupons can only be redeemed by branch staff using the coupon code.", 410);
  } catch (error) { next(error); }
});

app.get("/api/health", (_req, res) => {
  const mongoReady = atlasConnected && mongoose.connection.readyState === 1;
  const ready = !isProductionRuntime() || mongoReady;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "scratch-card",
    storage: mongoReady ? "mongodb-atlas" : "local-json",
    database: mongoReady ? "connected" : isProductionRuntime() ? "unavailable" : "local-development",
  });
});
app.get("/api/admin/coupons", authenticate, async (req, res, next) => {
  try {
    const id =
      req.user.role === "super-admin"
        ? req.query.business
        : req.user.businessId;
    const coupons = (await findAllCoupons()).filter(
      (item) => (!id || item.businessId === id)
        && (req.user.role === "super-admin" || !item.deletedAt)
        && (req.user.role !== "branch-staff" || item.branchId === req.user.branchId),
    );
    const usedCount = coupons.filter((item) => item.used).length;
    res.json({
      coupons,
      count: coupons.length,
      usedCount,
      waitingCount: coupons.length - usedCount,
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/admin/redeemed-coupons", authenticate, async (req, res, next) => {
  try {
    const id =
      req.user.role === "super-admin"
        ? req.query.business
        : req.user.businessId;
    const coupons = (await findAllCoupons()).filter(
      (item) => item.used && (!id || item.businessId === id)
        && (req.user.role === "super-admin" || !item.deletedAt)
        && (req.user.role !== "branch-staff" || item.branchId === req.user.branchId),
    );
    res.json({ coupons, count: coupons.length });
  } catch (error) {
    next(error);
  }
});
app.post("/api/cards", authenticate, async (req, res, next) => {
  try {
    const businessId = clean(req.body.businessId, 60) || req.user.businessId;
    if (req.user.role !== "super-admin" && req.user.businessId !== businessId)
      return res
        .status(403)
        .json({ message: "You can only create cards for your own business." });
    const business = await validateCreate(req);
    if (["branch-only", "brand-only"].includes(business.structureMode) && !req.body.branchId)
      throw bad("Choose a branch or brand for this scratch card.");
    const requestedCouponCode = clean(req.body.couponCode, 24).toUpperCase();
    const card = {
      ...buildCard(req.body, business),
      branchId: clean(req.body.branchId, 60),
      // Snapshot the verified branch, never a caller-supplied display name.
      branchName: clean(
        business.branches?.find((branch) => branch.branchId === req.body.branchId)?.name
          || "All branches",
        60,
      ),
    };
    await checkShareImageDimensions(card.shareImageBase64);
    const generation = await saveGeneration({ base: card,
      branches: [{ branchId: card.branchId, branchName: card.branchName, quantity: 1 }],
      total: 1, maximum: (await businessLimits(business)).card, requestedCode: requestedCouponCode });
    const savedCard = generation.coupons[0];
    await audit(req, "Scratch card created", businessId, savedCard.couponCode).catch(console.error);
    res
      .status(201)
      .json({ slug: savedCard.slug, couponCode: savedCard.couponCode });
  } catch (error) {
    next(error);
  }
});
app.post("/api/scratch-images", authenticate, async (req, res, next) => {
  try {
    if (["viewer", "branch-staff"].includes(req.user.role)) throw bad("This account cannot create scratch cards.", 403);
    res.status(201).json({ image: await saveBrand.saveScratchImage(req.body.image) });
  } catch (error) {
    next(error);
  }
});
app.get("/api/cards/:slug", async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(req.params.slug))
      throw Object.assign(new Error("Card not found."), { status: 404 });
    const card = await findCard(req.params.slug);
    if (!card) throw Object.assign(new Error("Card not found."), { status: 404 });
    await getBusiness(card.businessId || "impact-vibes");
    if (card.disabled)
      return res
        .status(410)
        .json({ code: "CARD_DISABLED", message: "This card is disabled." });
    if (card.expiresAt && new Date(card.expiresAt) < new Date())
      return res
        .set("Cache-Control", "no-store")
        .json({ ...publicCard(card), expired: true });
    const openedCard = await markCardOpened(card);
    res.set("Cache-Control", "no-store").json(publicCard(openedCard));
  } catch (error) {
    next(error);
  }
});
app.get("/api/cards/:slug/share-image", async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(req.params.slug))
      return res.status(404).end();
    const card = await findCard(req.params.slug, { includeImage: true });
    if (!card?.shareImageBase64 || !card.shareImageMime || card.disabled
      || (card.expiresAt && new Date(card.expiresAt) < new Date()))
      return res.status(404).end();
    await getBusiness(card.businessId || "impact-vibes");
    const image = await sharp(Buffer.from(card.shareImageBase64, "base64"))
      .rotate()
      .resize({
        width: SHARE_PREVIEW_WIDTH,
        height: SHARE_PREVIEW_HEIGHT,
        fit: "contain",
        background: { r: 255, g: 255, b: 255 },
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 72, chromaSubsampling: "4:2:0", progressive: true })
      .toBuffer();
    res.set({
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      "Content-Type": "image/jpeg",
      "Content-Length": String(image.length),
      "X-Content-Type-Options": "nosniff",
    }).send(image);
  } catch (error) {
    next(error);
  }
});
app.get("/share/:slug", async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(req.params.slug))
      throw Object.assign(new Error("Card not found."), { status: 404 });
    const card = await findCard(req.params.slug);
    if (!card) throw Object.assign(new Error("Card not found."), { status: 404 });
    await getBusiness(card.businessId || "impact-vibes");
    if (card.disabled) throw Object.assign(new Error("This card is disabled."), { status: 410 });
    const slug = encodeURIComponent(card.slug);
    const cardUrl = `${PRODUCTION_APP_URL}/card/${slug}`;
    const version = /^\d+$/.test(String(req.query.v || "")) ? String(req.query.v) : SHARE_PREVIEW_VERSION;
    const shareUrl = `${PRODUCTION_APP_URL}/share/${slug}?v=${encodeURIComponent(version)}`;
    const imageUrl = card.shareImageMime && !(card.expiresAt && new Date(card.expiresAt) < new Date())
      ? `${PRODUCTION_APP_URL}/share/${slug}/image?v=${encodeURIComponent(version)}`
      : "";
    const title = card.shareTitle || "Congratulation you got an offer";
    // Never reveal the reward in a social preview; the recipient must open and
    // scratch the card before seeing the offer.
    const description = "A surprise is waiting for you. Open the scratch card to reveal your offer.";
    const imageMeta = imageUrl ? `
    <meta property="og:image" content="${html(imageUrl)}">
    <meta property="og:image:secure_url" content="${html(imageUrl)}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="${SHARE_PREVIEW_WIDTH}">
    <meta property="og:image:height" content="${SHARE_PREVIEW_HEIGHT}">
    <meta property="og:image:alt" content="Scratch-card surprise preview">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${html(imageUrl)}">` : "";
    res.status(200).set({
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    }).send(`<!doctype html>
<html lang="en"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${html(title)}</title>
    <meta name="description" content="${html(description)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="JustConnect Scratch Card">
    <meta property="og:title" content="${html(title)}">
    <meta property="og:description" content="${html(description)}">
    <meta property="og:url" content="${html(shareUrl)}">${imageMeta}
    <link rel="canonical" href="${html(shareUrl)}">
  </head><body>
    <p>Opening your scratch card… <a href="${html(cardUrl)}">Continue</a></p>
    <script>window.location.replace(${JSON.stringify(cardUrl)});</script>
  </body></html>`);
  } catch (error) {
    next(error);
  }
});
app.get(["/share", "/share/*rest"], (_req, _res, next) => {
  next(Object.assign(new Error("Card not found."), { status: 404 }));
});
app.post("/api/cards/:slug/claim", async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(req.params.slug))
      return res.status(404).json({ message: "Card not found." });
    const existing = await findCard(req.params.slug);
    if (
      existing &&
      (existing.disabled ||
        (existing.expiresAt && new Date(existing.expiresAt) < new Date()))
    )
      return res
        .status(410)
        .json({ message: "This card is disabled or expired." });
    if (existing) {
      const business = await getBusiness(existing.businessId || "impact-vibes");
      if (business.status !== "active")
        return res
          .status(403)
          .json({ message: "This business has paused its rewards." });
      if (existing.branchId && !business.branches?.some((branch) =>
        branch.branchId === existing.branchId && branch.status === "active"))
        return res.status(403).json({ message: "This coupon's assigned branch is not active." });
    }
    const result = await claimCard(req.params.slug);
    if (result.status === "missing")
      return res.status(404).json({ message: "Card not found." });
    if (result.status === "unavailable")
      return res
        .status(410)
        .json({ message: "This card is disabled or expired." });
    if (result.status === "used")
      return res
        .status(409)
        .json({
          message: "This coupon has already been scratched.",
          used: true,
        });
    await audit(req, "Coupon scratched", result.card.businessId || "impact-vibes",
      `${result.card.couponCode} · ${result.card.redeemedBranchId || "All branches"}`).catch(console.error);
    res.set("Cache-Control", "no-store").json({
      couponCode: result.card.couponCode,
      scratchedAt: result.card.scratchedAt,
      redeemedAt: null,
      status: "scratched",
    });
  } catch (error) {
    next(error);
  }
});

// Unknown API paths answer in JSON, never with the SPA page or an HTML 404.
app.use("/api", (_req, res) => res.status(404).json({ message: "This API route does not exist." }));

const isLocalServer =
  !process.env.NETLIFY &&
  !process.env.VERCEL &&
  !process.env.AWS_LAMBDA_FUNCTION_NAME &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(rootDir, "server", "src", "app", "index.js");
// Render hosts only the API. Serve the SPA when a local build exists, instead
// of answering every unknown path with a missing-file error and server path.
const clientDist = path.join(rootDir, "client", "dist");
if (isLocalServer && existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get("/*splat", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}
app.use((error, req, res, _next) => {
  const status = errorStatus(error);
  // Unexpected failures need their stack in the host logs. Deliberate API
  // errors (validation, permissions, expired sessions) need only one line.
  if (status >= 500) console.error(`${req.method} ${req.path} failed (${status}):`, error);
  else console.warn(`${req.method} ${req.path} -> ${status}: ${error.message}`);
  if (/^\/share(?:\/|$)/.test(req.path)) {
    const problem = publicCardProblem(error);
    return res.status(problem.status).set({
      "Cache-Control": "private, no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    }).send(publicCardErrorPage(problem, `/share/${encodeURIComponent(req.params.slug || req.path.split('/')[2] || '')}`));
  }
  if (/^\/api\/cards\/[^/]+\/share-image\/?$/.test(req.path))
    return res.status(publicCardProblem(error).status).end();
  if ((req.method === "GET" && /^\/api\/cards\/[^/]+\/?$/.test(req.path))
    || (req.method === "POST" && /^\/api\/cards\/[^/]+\/claim\/?$/.test(req.path))) {
    const problem = publicCardProblem(error);
    return res.status(problem.status).json({ code: problem.code, message: problem.description });
  }
  if (req.path === "/api/cards/bulk") {
    const uncertain = error.hasErrorLabel?.("UnknownTransactionCommitResult");
    // Any unexpected batch failure stays retryable with the same batch key.
    return res.status(status === 500 ? 503 : status).json({
      message: `${errorMessage(error, status)} ${uncertain
        ? "Commit confirmation was lost. Retry the same batch to recover the actual saved count."
        : "No coupons were saved by this request. Retry with the same batch key."}`,
      savedCount: uncertain ? null : 0,
    });
  }
  if (error.code === "DUPLICATE_COUPON" || error.code === 11000)
    return res
      .status(409)
      .json({
        message:
          "This coupon code already exists. Choose another code or leave it blank.",
      });
  res
    .status(status)
    .json({
      message: errorMessage(error, status),
      ...(error.details ? { details: error.details } : {}),
    });
});

if (isLocalServer) {
  connectDatabase()
    .then(() => {
      const server = app.listen(port, () =>
        console.log(`JustConnect Rewards API: http://localhost:${port}`),
      );
      // Hosting proxies reuse idle upstream connections. Keep them open longer
      // than the proxy does, so it never sends a request on a socket Node has
      // just closed, which surfaces as an intermittent 502.
      server.keepAliveTimeout = 120000;
      server.headersTimeout = 121000;
      // Deploys and restarts send SIGTERM. Finish in-flight requests (bulk
      // generation, redemptions) instead of dropping them, then exit.
      let stopping = false;
      const stop = (signal) => {
        if (stopping) return;
        stopping = true;
        console.log(`${signal} received; finishing in-flight requests before exiting.`);
        setTimeout(() => process.exit(1), 25000).unref();
        server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
        server.closeIdleConnections();
      };
      process.once("SIGTERM", () => stop("SIGTERM"));
      process.once("SIGINT", () => stop("SIGINT"));
    })
    .catch((error) => {
      console.error("Database connection failed:", error.message);
      process.exit(1);
    });
}
