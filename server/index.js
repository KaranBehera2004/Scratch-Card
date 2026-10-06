import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { installControls } from "./control.js";
import { ensureUniqueIndex } from "./indexes.js";

const rootDir = process.env.SCRATCH_DATA_ROOT || process.cwd();
const dataDir = path.join(rootDir, "server", "data");
const dataFile = path.join(dataDir, "cards.json");
const businessesFile = path.join(dataDir, "businesses.json");
export const app = express();
const port = Number(process.env.PORT) || 5051;

app.disable("x-powered-by");
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: "20kb" }));

const schema = new mongoose.Schema(
  {
    slug: { type: String, unique: true, index: true, required: true },
    senderName: { type: String, required: true, maxlength: 50 },
    headline: { type: String, required: true, maxlength: 80 },
    offerTitle: { type: String, required: true, maxlength: 30 },
    description: { type: String, required: true, maxlength: 80 },
    couponCode: { type: String, required: true, maxlength: 24 },
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
      status: { type: String, default: "active" },
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
async function saveCard(card, requestedCode) {
  if (atlasConnected) {
    const candidate = {
      ...card,
      couponCode: requestedCode || generateCouponCode(),
    };
    try {
      return await Card.create(candidate);
    } catch (error) {
      if (error.code === 11000) {
        if (requestedCode) {
          const duplicate = new Error(
            "This coupon code already exists. Choose another code or leave it blank.",
          );
          duplicate.code = "DUPLICATE_COUPON";
          throw duplicate;
        }
        return saveCard(card, "");
      }
      throw error;
    }
  }
  return mutateLocalCards((cards) => {
    const usedCodes = new Set(
      cards.map((item) => clean(item.couponCode, 24).toUpperCase()),
    );
    if (requestedCode && usedCodes.has(requestedCode)) {
      const duplicate = new Error(
        "This coupon code already exists. Choose another code or leave it blank.",
      );
      duplicate.code = "DUPLICATE_COUPON";
      throw duplicate;
    }
    let couponCode = requestedCode || generateCouponCode();
    while (usedCodes.has(couponCode)) couponCode = generateCouponCode();
    const savedCard = {
      ...card,
      couponCode,
      createdAt: new Date().toISOString(),
    };
    cards.push(savedCard);
    return savedCard;
  });
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
          "slug couponCode offerTitle senderName businessId createdAt redeemedAt",
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
      createdAt,
      redeemedAt,
    }) => ({
      slug,
      couponCode,
      offerTitle,
      senderName,
      businessId: businessId || "impact-vibes",
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
    if (cards[index].redeemedAt) return { status: "used" };
    if (
      cards[index].disabled ||
      (cards[index].expiresAt && new Date(cards[index].expiresAt) <= new Date())
    )
      return { status: "unavailable" };
    cards[index].redeemedAt = new Date().toISOString();
    return { status: "claimed", card: cards[index] };
  });
}
async function claimCard(slug) {
  if (!atlasConnected) return claimLocalCard(slug);
  const card = await Card.findOneAndUpdate(
    {
      slug,
      disabled: { $ne: true },
      redeemedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    },
    { $set: { redeemedAt: new Date() } },
    { new: true },
  ).lean();
  if (card) return { status: "claimed", card };
  const existing = await Card.findOne({ slug }).lean();
  return {
    status: !existing
      ? "missing"
      : existing.redeemedAt
        ? "used"
        : "unavailable",
  };
}
function publicCard(card) {
  const { _id, couponCode, ...safeCard } = card;
  return { ...safeCard, used: Boolean(card.redeemedAt), redeemedAt: undefined };
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
const { authenticate, audit, validateCreate, getBusiness } = installControls(
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
    if (req.body.language !== undefined && !["en", "hi", "te"].includes(req.body.language))
      return res.status(400).json({ message: "Choose English, Hindi or Telugu for the card language." });
    const requestedCouponCode = clean(req.body.couponCode, 24).toUpperCase();
    const card = {
      slug: crypto.randomBytes(6).toString("base64url"),
      senderName: clean(business.name, 50),
      language: req.body.language || "en",
      headline: clean(req.body.headline, 80),
      offerTitle: clean(req.body.offerTitle, 30),
      description: clean(req.body.description, 80),
      claimUrl: safeUrl(req.body.claimUrl),
      accentColor: /^#[0-9a-f]{6}$/i.test(req.body.accentColor)
        ? req.body.accentColor
        : "#ffb33f",
      pageColor: /^#[0-9a-f]{6}$/i.test(req.body.pageColor)
        ? req.body.pageColor
        : "#0b0c1c",
      textColor: /^#[0-9a-f]{6}$/i.test(req.body.textColor)
        ? req.body.textColor
        : "#ffffff",
      businessId,
      branchId: clean(req.body.branchId, 60),
      // Snapshot the verified branch, never a caller-supplied display name.
      branchName: clean(
        business.branches?.find((branch) => branch.branchId === req.body.branchId)?.name
          || "All branches",
        60,
      ),
      campaignName: clean(req.body.campaignName, 80),
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
      disabled: false,
    };
    if (
      card.expiresAt &&
      (!Number.isFinite(card.expiresAt.getTime()) ||
        card.expiresAt <= new Date())
    )
      return res
        .status(400)
        .json({ message: "Choose an expiry date in the future." });
    if (
      !card.senderName ||
      !card.headline ||
      !card.offerTitle ||
      !card.description
    )
      return res
        .status(400)
        .json({ message: "Please complete all required fields." });
    const savedCard = await saveCard(card, requestedCouponCode);
    await audit(req, "Scratch card created", businessId, savedCard.couponCode);
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
          message: "This coupon has already been revealed and used.",
          used: true,
        });
    res.json({
      couponCode: result.card.couponCode,
      redeemedAt: result.card.redeemedAt,
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
app.use((error, _req, res, _next) => {
  console.error(error.message);
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
