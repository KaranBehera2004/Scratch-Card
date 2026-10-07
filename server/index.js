import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { installControls } from "./control.js";
import { ensureUniqueIndex } from "./indexes.js";
import { normalizeWhatsAppNumber } from "../shared/whatsapp.js";
import { PRODUCTION_APP_URL } from "../shared/urls.js";
import { installBulkRoutes, bad, couponStatus, checkCapacity } from "./bulk.js";

const rootDir = process.env.SCRATCH_DATA_ROOT || process.cwd();
const dataDir = path.join(rootDir, "server", "data");
const dataFile = path.join(dataDir, "cards.json");
const businessesFile = path.join(dataDir, "businesses.json");
export const app = express();
const port = Number(process.env.PORT) || 5051;

app.disable("x-powered-by");
app.use(cors({ origin: process.env.CLIENT_ORIGIN ||
  (process.env.NODE_ENV === "production" ? PRODUCTION_APP_URL : true) }));
// A bounded 1,000-row recipient import can exceed the original single-card cap.
app.use(express.json({ limit: "256kb" }));

const schema = new mongoose.Schema(
  {
    slug: { type: String, unique: true, index: true, required: true },
    senderName: { type: String, required: true, maxlength: 50 },
    headline: { type: String, required: true, maxlength: 80 },
    offerTitle: { type: String, required: true, maxlength: 30 },
    description: { type: String, required: true, maxlength: 80 },
    couponCode: { type: String, required: true, maxlength: 24 },
    customerPhone: { type: String, maxlength: 16, default: "" },
    claimUrl: { type: String, maxlength: 500, default: "" },
    accentColor: { type: String, default: "#ffb33f" },
    pageColor: { type: String, default: "#0b0c1c" },
    textColor: { type: String, default: "#ffffff" },
    businessId: { type: String, default: "impact-vibes", index: true },
    branchId: { type: String, default: "" },
    branchName: { type: String, maxlength: 60 },
    language: { type: String, enum: ["en", "hi", "te"], default: "en" },
    campaignName: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
    disabled: { type: Boolean, default: false },
    redeemedAt: { type: Date, default: null },
    scratchedAt: { type: Date, default: null },
    redeemedBranchId: { type: String, default: "" },
    batchKey: { type: String, index: true },
    batchFingerprint: String,
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
      branches: {
        type: [
          { branchId: String, name: String, address: String, status: String },
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
async function listBusinesses() {
  return atlasConnected
    ? Business.find({ status: { $ne: "deleted" } }).sort({ createdAt: -1 }).lean()
    : (await readBusinesses()).filter((business) => business.status !== "deleted");
}

export function connectDatabase() {
  if (atlasConnected) return Promise.resolve();
  if (databasePromise) return databasePromise;

  databasePromise = initializeDatabase().catch((error) => {
    databasePromise = null;
    atlasConnected = false;
    throw error;
  });
  return databasePromise;
}

async function initializeDatabase() {
  if (
    !process.env.MONGODB_URI &&
    (process.env.NETLIFY ||
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME)
  ) {
    throw new Error(
      "MongoDB Atlas is not configured. Add MONGODB_URI in your hosting environment variables and redeploy.",
    );
  }
  if (!process.env.MONGODB_URI) {
    await fs.mkdir(dataDir, { recursive: true });
    await normalizeLocalCoupons();
    await ensureImpactVibes();
    console.log("Storage: local JSON (add MONGODB_URI to use MongoDB Atlas)");
    return;
  }
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB || "scratch_cards",
  });
  await normalizeMongoCoupons();
  await ensureUniqueIndex(Card.collection, "couponCode", "unique_coupon_code");
  await ensureUniqueIndex(Card.collection, "slug", "unique_scratch_slug");
  await Card.collection.createIndex({ batchKey: 1 });
  await CouponBatch.init();
  await ensureUniqueIndex(CouponBatch.collection, "key", "unique_coupon_batch_key");
  await Card.updateMany({ redeemedAt: { $ne: null }, scratchedAt: null }, [
    { $set: { scratchedAt: "$redeemedAt" } },
  ]);
  // Scratching is now redemption. Preserve the original reveal time and branch.
  await Card.updateMany({ scratchedAt: { $ne: null }, redeemedAt: null }, [
    { $set: { redeemedAt: "$scratchedAt", redeemedBranchId: { $ifNull: ["$branchId", ""] } } },
  ]);
  const ControlRecord = mongoose.model("ControlRecord");
  await ControlRecord.init();
  await Business.init();
  await ensureUniqueIndex(ControlRecord.collection, "key", "unique_control_key");
  await ensureUniqueIndex(Business.collection, "businessId", "unique_business_id");
  await ensureUniqueIndex(Business.collection, "loginId", "unique_business_login_id", { sparse: true });
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
    // Keep historical timestamps; never reactivate a previously revealed coupon.
    if (card.redeemedAt && !card.scratchedAt) {
      card.scratchedAt = card.redeemedAt;
      changed = true;
    }
    if (card.scratchedAt && !card.redeemedAt) {
      card.redeemedAt = card.scratchedAt;
      card.redeemedBranchId = card.branchId || "";
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
async function normalizeMongoCoupons() {
  const cards = await Card.find().sort({ createdAt: 1, _id: 1 }).lean();
  const usedCodes = new Set();
  for (const card of cards) {
    let code = clean(card.couponCode, 24).toUpperCase();
    while (!code || usedCodes.has(code)) code = generateCouponCode();
    if (card.couponCode !== code)
      await Card.updateOne({ _id: card._id }, { $set: { couponCode: code } });
    usedCodes.add(code);
  }
}
async function findCard(slug) {
  return atlasConnected
    ? Card.findOne({ slug }).lean()
    : (await readLocalCards()).find((card) => card.slug === slug);
}
async function findRedeemedCoupons() {
  if (atlasConnected) {
    return Card.find({ redeemedAt: { $ne: null } })
      .select("slug couponCode offerTitle senderName redeemedAt")
      .sort({ redeemedAt: -1 })
      .lean();
  }
  return (await readLocalCards())
    .filter((card) => card.redeemedAt)
    .sort((a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt))
    .map(({ slug, couponCode, offerTitle, senderName, redeemedAt }) => ({
      slug,
      couponCode,
      offerTitle,
      senderName,
      redeemedAt,
    }));
}
async function findAllCoupons() {
  const visibleBusinesses = new Set((await listBusinesses()).map((business) => business.businessId));
  const cards = atlasConnected
    ? await Card.find()
        .select(
          "slug couponCode offerTitle senderName businessId customerPhone expiresAt createdAt redeemedAt",
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
      customerPhone,
      expiresAt,
      createdAt,
      redeemedAt,
    }) => ({
      slug,
      couponCode,
      offerTitle,
      senderName,
      businessId: businessId || "impact-vibes",
      customerPhone: customerPhone || "",
      expiresAt: expiresAt || null,
      createdAt,
      redeemedAt: redeemedAt || null,
      used: Boolean(redeemedAt),
    }),
  );
}
async function claimLocalCard(slug) {
  return mutateLocalCards((cards) => {
    const index = cards.findIndex((card) => card.slug === slug);
    if (index === -1) return { status: "missing" };
    if (cards[index].redeemedAt || cards[index].scratchedAt) return { status: "used" };
    if (
      cards[index].disabled ||
      (cards[index].expiresAt && new Date(cards[index].expiresAt) <= new Date())
    )
      return { status: "unavailable" };
    const redeemedAt = new Date().toISOString();
    cards[index].scratchedAt = redeemedAt;
    cards[index].redeemedAt = redeemedAt;
    cards[index].redeemedBranchId = cards[index].branchId || "";
    return { status: "claimed", card: cards[index] };
  });
}
async function claimCard(slug) {
  if (!atlasConnected) return claimLocalCard(slug);
  const redeemedAt = new Date();
  const card = await Card.findOneAndUpdate(
    {
      slug,
      disabled: { $ne: true },
      redeemedAt: null,
      scratchedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: redeemedAt } }],
    },
    [{ $set: { scratchedAt: redeemedAt, redeemedAt,
      redeemedBranchId: { $ifNull: ["$branchId", ""] } } }],
    { new: true },
  ).lean();
  if (card) return { status: "claimed", card };
  const existing = await Card.findOne({ slug }).lean();
  return {
    status: !existing
      ? "missing"
      : existing.redeemedAt || existing.scratchedAt
        ? "used"
        : "unavailable",
  };
}
function publicCard(card) {
  // Explicitly allow presentation fields only. Customer contact details are private.
  const fields = ["slug", "senderName", "headline", "offerTitle", "description",
    "claimUrl", "accentColor", "pageColor", "textColor", "businessId",
    "branchId", "branchName", "language", "campaignName", "expiresAt", "createdAt"];
  return {
    ...Object.fromEntries(fields.map((key) => [key, card[key]])),
    used: Boolean(card.redeemedAt || card.scratchedAt),
    scratchedAt: card.scratchedAt || null,
  };
}
const clean = (value, max) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const safeUrl = (value) => {
  const raw = clean(value, 500);
  if (!raw) return "";
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Claim link must use http or https.");
  return parsed.toString();
};
const { authenticate, audit, validateCreate, getBusiness, businessLimits, cardRows, scope } = installControls(
  app,
  {
    Business,
    Card,
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
  },
);

function buildCard(body, business, bulk = false, allowExpired = false) {
  if (body.language !== undefined && !["en", "hi", "te"].includes(body.language))
    throw bad("Choose English, Hindi or Telugu for the card language.");
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || (!allowExpired && expiresAt <= new Date())))
    throw bad("Choose an expiry date in the future.");
  const card = {
    senderName: clean(business.name, 50), businessId: business.businessId,
    language: body.language || "en", headline: clean(body.headline, 80),
    offerTitle: clean(body.offerTitle, 30), description: clean(body.description, 80),
    customerPhone: bulk && (body.customerPhone == null || (typeof body.customerPhone === "string" && !body.customerPhone.trim()))
      ? "" : normalizeWhatsAppNumber(body.customerPhone),
    claimUrl: safeUrl(body.claimUrl), campaignName: clean(body.campaignName, 80), expiresAt,
    disabled: false, redeemedAt: null, scratchedAt: null,
    ...Object.fromEntries([["accentColor", "#ffb33f"], ["pageColor", "#0b0c1c"], ["textColor", "#ffffff"]]
      .map(([key, fallback]) => [key, /^#[0-9a-f]{6}$/i.test(body[key]) ? body[key] : fallback])),
  };
  if (!card.senderName || !card.headline || !card.offerTitle || !card.description)
    throw bad("Please complete all required fields.");
  return card;
}
const batchCard = (card) => Object.fromEntries([
  "slug", "branchId", "branchName", "couponCode", "offerTitle", "description",
  "campaignName", "expiresAt", "createdAt", "scratchedAt", "redeemedAt", "customerPhone",
].map((key) => [key, card[key] ?? null]));
function batchResult(key, fingerprint, cards, replayed = false) {
  return { batchId: key, fingerprint, savedCount: cards.length, replayed,
    coupons: cards.map((card) => ({ ...batchCard(card), status: couponStatus(card) })) };
}
async function findBatch(key) {
  if (atlasConnected) {
    const batch = await CouponBatch.findOne({ key }).lean();
    if (!batch) return null;
    return batchResult(key, batch.fingerprint, await Card.find({ batchKey: key }).sort({ createdAt: 1, _id: 1 }).lean());
  }
  const cards = (await readLocalCards()).filter((card) => card.batchKey === key);
  return cards.length ? batchResult(key, cards[0].batchFingerprint, cards) : null;
}
async function saveGeneration({ base, branches, total, maximum, batchKey, fingerprint, recipients = null, requestedCode = "" }) {
  const makeCards = (existing = []) => {
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
      cards.push({ ...base, branchId: branch.branchId, branchName: clean(branch.branchName, 60), slug, couponCode, createdAt,
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
            const cards = await Card.find({ batchKey }).sort({ createdAt: 1, _id: 1 }).session(session).lean();
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

app.post("/api/portal/cards/:slug/redeem", authenticate, async (req, res, next) => {
  try {
    if (req.user.role === "viewer") throw bad("Viewer accounts cannot redeem coupons.", 403);
    const card = (await cardRows(req)).find((item) => item.slug === req.params.slug);
    if (!card) throw bad("Card not found.", 404);
    // Tell older clients to upgrade; this endpoint must never consume a coupon.
    throw bad("Coupons are redeemed automatically when scratched. Manual redemption is no longer supported.", 410);
  } catch (error) { next(error); }
});

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "scratch-card",
    storage: atlasConnected ? "mongodb-atlas" : "local-json",
  }),
);
app.get("/api/admin/coupons", authenticate, async (req, res, next) => {
  try {
    const id =
      req.user.role === "super-admin"
        ? req.query.business
        : req.user.businessId;
    const coupons = (await findAllCoupons()).filter(
      (item) => !id || item.businessId === id,
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
      (item) => item.used && (!id || item.businessId === id),
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
app.get("/api/cards/:slug", async (req, res, next) => {
  try {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(req.params.slug))
      return res.status(404).json({ message: "Card not found." });
    const card = await findCard(req.params.slug);
    if (!card) return res.status(404).json({ message: "Card not found." });
    await getBusiness(card.businessId || "impact-vibes");
    if (
      card.disabled ||
      (card.expiresAt && new Date(card.expiresAt) < new Date())
    )
      return res
        .status(410)
        .json({ message: "This card is disabled or expired." });
    res.json(publicCard(card));
  } catch (error) {
    next(error);
  }
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
          message: "This coupon has already been redeemed.",
          used: true,
        });
    await audit(req, "Coupon redeemed by scratching", result.card.businessId || "impact-vibes",
      `${result.card.couponCode} · ${result.card.redeemedBranchId || "All branches"}`).catch(console.error);
    res.set("Cache-Control", "no-store").json({
      couponCode: result.card.couponCode,
      scratchedAt: result.card.scratchedAt,
      redeemedAt: result.card.redeemedAt,
      status: "redeemed",
    });
  } catch (error) {
    next(error);
  }
});

const isLocalServer =
  !process.env.NETLIFY &&
  !process.env.VERCEL &&
  !process.env.AWS_LAMBDA_FUNCTION_NAME &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(rootDir, "server", "index.js");
if (isLocalServer) {
  app.use(express.static(path.join(rootDir, "client", "dist")));
  app.get("/*splat", (_req, res) =>
    res.sendFile(path.join(rootDir, "client", "dist", "index.html")),
  );
}
app.use((error, req, res, _next) => {
  console.error(error.message);
  if (req.path === "/api/cards/bulk") {
    const uncertain = error.hasErrorLabel?.("UnknownTransactionCommitResult");
    return res.status(error.status || 503).json({
      message: `${error.message || "Batch generation failed."} ${uncertain
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
    .status(error.status || 400)
    .json({ message: error.message || "Something went wrong." });
});

if (isLocalServer) {
  connectDatabase()
    .then(() =>
      app.listen(port, () =>
        console.log(`Lucky Drop API: http://localhost:${port}`),
      ),
    )
    .catch((error) => {
      console.error("Database connection failed:", error.message);
      process.exit(1);
    });
}
