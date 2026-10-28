import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { couponStatus } from "./bulk.js";
import { COUPON_STATUSES } from "../../shared/coupon-status.js";

const text = (value, max = 120) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
// Legacy storage: departments are location branches; branches are their departments.
const checkDepartmentName = (branches, candidate) => {
  if (!candidate.departmentId) return;
  if (branches.some((item) => item.status !== "deleted"
    && item.branchId !== candidate.branchId
    && item.departmentId === candidate.departmentId
    && text(item.name, 60).toLowerCase() === candidate.name.toLowerCase()))
    throw fail(`Branch name already exists in this department: ${candidate.name}`);
};
const safe = (value) => {
  const { passwordHash, passwordVersion, ...result } = value;
  return result;
};
const equal = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const defaults = {
  platformName: "JustConnect Rewards",
  supportEmail: "",
  supportUrl: "",
  loginMessage: "Sign in to manage your scratch-card workspace.",
  defaultLimits: { card: 100, branch: 2, department: 2, account: 1 },
  memberAccess: true,
  cardCreation: true,
  sessionHours: 12,
};
const basePlans = [
  {
    id: "starter",
    name: "Starter",
    cardLimit: 100,
    branchLimit: 2,
    departmentLimit: 2,
    userLimit: 3,
    monthlyPrice: 0,
  },
  {
    id: "growth",
    name: "Growth",
    cardLimit: 1000,
    branchLimit: 10,
    departmentLimit: 10,
    userLimit: 20,
    monthlyPrice: 999,
  },
  {
    id: "unlimited",
    name: "Unlimited",
    cardLimit: 0,
    branchLimit: 0,
    departmentLimit: 0,
    userLimit: 0,
    monthlyPrice: 0,
  },
];
const Meta = mongoose.model(
  "ControlRecord",
  new mongoose.Schema(
    {
      key: { type: String, unique: true },
      value: mongoose.Schema.Types.Mixed,
      revision: { type: Number, default: 0 },
    },
    { versionKey: false, autoIndex: false },
  ),
);

export function installControls(app, context) {
  const {
    Business,
    Card,
    CouponBatch,
    listBusinesses,
    readBusinesses,
    writeBusinesses,
    readLocalCards,
    mutateLocalCards,
    dataDir,
    isMongo,
    hashPassword,
    verifyPassword,
    safeUrl,
    saveBrand,
  } = context;
  let queue = Promise.resolve();
  const filename = path.join(dataDir, "control.json");
  const metaReads = new Map();
  async function readMeta(keys = null) {
    const requested = Array.isArray(keys) ? [...new Set(keys)].sort() : null;
    if (isMongo())
      {
        const cacheKey = requested?.join("|") || "*";
        if (metaReads.has(cacheKey)) return metaReads.get(cacheKey);
        const pending = Meta.find(requested ? { key: { $in: requested } } : {})
          .select("key value -_id")
          .lean()
          .then((items) => Object.fromEntries(items.map((item) => [item.key, item.value])))
          .finally(() => metaReads.delete(cacheKey));
        metaReads.set(cacheKey, pending);
        return pending;
      }
    try {
      const all = JSON.parse(await fs.readFile(filename, "utf8"));
      return requested
        ? Object.fromEntries(requested.filter((key) => key in all).map((key) => [key, all[key]]))
        : all;
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }
  async function changeMeta(key, mutate) {
    const run = queue.then(async () => {
      // Multiple serverless instances must not overwrite each other's staff or audit changes.
      if (isMongo()) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const record = await Meta.findOne({ key }).lean(),
            value = mutate(record?.value);
          if (!record) {
            try {
              await Meta.create({ key, value, revision: 1 });
              return value;
            } catch (error) {
              if (error.code === 11000) continue;
              throw error;
            }
          }
          const revision =
            record.revision === undefined
              ? { $exists: false }
              : record.revision;
          const saved = await Meta.updateOne(
            { _id: record._id, revision },
            { $set: { value }, $inc: { revision: 1 } },
          );
          if (saved.modifiedCount) return value;
        }
        throw fail("Another update is in progress. Please retry.", 409);
      }
      const all = await readMeta(),
        value = mutate(all[key]);
      all[key] = value;
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(`${filename}.tmp`, JSON.stringify(all, null, 2));
      // Windows readers/antivirus can briefly hold the destination during
      // concurrent staff requests. Retry the same atomic rename, not the mutation.
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(`${filename}.tmp`, filename); break; }
        catch (error) {
          if (!["EPERM", "EBUSY"].includes(error.code) || attempt >= 4) throw error;
          await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt));
        }
      }
      return value;
    });
    queue = run.catch(() => {});
    return run;
  }
  const settings = async () => {
    const saved = (await readMeta(["settings"])).settings || {};
    const savedLimits = saved.defaultLimits || {};
    return {
      ...defaults,
      ...saved,
      defaultLimits: {
        ...defaults.defaultLimits,
        ...savedLimits,
        // Existing installations predate department limits. Start them with
        // the configured branch allowance instead of silently making them unlimited.
        department: savedLimits.department ?? savedLimits.branch ?? defaults.defaultLimits.department,
      },
    };
  };
  // Read old assignments only to preserve existing businesses' allowances.
  const legacyPlans = async () => (await readMeta(["plans"])).plans || basePlans;
  async function businessLimits(business, legacy = null) {
    const plan = (legacy || (await legacyPlans())).find(
      (item) => item.id === business.planId,
    );
    const previousUsers = business.limits?.user ?? plan?.userLimit ?? 0;
    return {
      card: business.limits?.card ?? plan?.cardLimit ?? 0,
      branch: business.limits?.branch ?? plan?.branchLimit ?? 0,
      department:
        business.limits?.department ??
        plan?.departmentLimit ??
        business.limits?.branch ??
        plan?.branchLimit ??
        0,
      account:
        business.limits?.account ?? (previousUsers > 0 ? previousUsers + 1 : 0),
    };
  }
  function validateLimits(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw fail("Enter the business's card, branch, department and account limits.");
    const limits = {};
    for (const key of ["card", "branch", "department", "account"]) {
      // Older clients did not send a department allowance. Matching the
      // branch allowance keeps those requests compatible and bounded.
      const input = key === "department" && value[key] === undefined
        ? value.branch
        : value[key];
      if (
        !["number", "string"].includes(typeof input) ||
        String(input).trim() === ""
      )
        throw fail(`Enter a ${key} limit.`);
      const number = Number(input);
      if (!Number.isSafeInteger(number) || number < 0 || number > 1e9)
        throw fail(
          `${key} limit must be a whole number from 0 to 1,000,000,000. Use 0 for unlimited.`,
        );
      limits[key] = number;
    }
    return limits;
  }
  const users = async () => (await readMeta(["users"])).users || [];
  const primaryLogin = () => String(process.env.SUPER_ADMIN_LOGIN_ID || process.env.SUPER_ADMIN_EMAIL || "admin@luckydrop.local").trim().toLowerCase();
  const validateLoginId = (value) => {
    const loginId = String(value || "").trim();
    if (!/^(?=.*[a-z])(?=.*\d)[a-z\d]{6,16}$/i.test(loginId))
      throw fail("Login ID must be 6–16 characters and contain only letters and numbers, including at least one of each.");
    return loginId;
  };
  const loginIdInUse = async (value, excludeBusinessId = "", reusableStaffBusinessId = "") => {
    const key = String(value || "").toLowerCase(), meta = await readMeta(["users", "superAdmins"]);
    return key === primaryLogin()
      || (await listBusinesses()).some((item) => item.businessId !== excludeBusinessId
        && String(item.loginId || item.loginEmail || "").toLowerCase() === key)
      || (meta.users || []).some((item) => String(item.loginId || item.email || "").toLowerCase() === key
        && !(reusableStaffBusinessId && item.businessId === reusableStaffBusinessId
          && item.role === "branch-staff" && item.status === "deleted"))
      || (meta.superAdmins || []).some((item) => String(item.loginId || "").toLowerCase() === key);
  };
  async function reserveLoginId(value, { current = "", excludeBusinessId = "", reusableStaffBusinessId = "" } = {}) {
    const loginId = validateLoginId(value), key = loginId.toLowerCase(), currentKey = String(current || "").toLowerCase();
    if (key !== currentKey && await loginIdInUse(loginId, excludeBusinessId, reusableStaffBusinessId))
      throw fail("This login ID already exists.", 409);
    const reusableDeletedStaff = reusableStaffBusinessId && (await users()).some(item =>
      item.businessId === reusableStaffBusinessId && item.role === "branch-staff" && item.status === "deleted"
      && String(item.loginId || item.email || "").toLowerCase() === key);
    // Preserve the old reservation and archived identity. Creating a replacement
    // is serialized by the non-deleted-user uniqueness check below instead.
    if (reusableDeletedStaff) return loginId;
    await changeMeta("loginIds", (ids = []) => {
      if (key !== currentKey && ids.some((item) => String(item).toLowerCase() === key))
        throw fail("This login ID already exists.", 409);
      return ids.some((item) => String(item).toLowerCase() === key) ? ids : [...ids, loginId];
    });
    return loginId;
  }
  // Reserve login IDs atomically across server instances. Passwords are
  // supplied by the creating administrator and only their hashes are stored.
  async function issueLoginId() {
    let loginId;
    const meta = await readMeta(["users", "superAdmins"]);
    const occupied = new Set([
      primaryLogin(),
      ...(await listBusinesses()).map((item) => String(item.loginId || item.loginEmail || "").toLowerCase()),
      ...(meta.users || []).map((item) => String(item.loginId || item.email || "").toLowerCase()),
      ...(meta.superAdmins || []).map((item) => String(item.loginId || "").toLowerCase()),
    ]);
    await changeMeta("loginIds", (ids = []) => {
      for (const id of ids) occupied.add(String(id).toLowerCase());
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", digits = "0123456789",
        characters = `${letters}${digits}`,
        pick = (source) => source[crypto.randomInt(source.length)];
      do {
        const parts = [pick(letters), pick(digits), ...Array.from({ length: 10 }, () => pick(characters))];
        for (let index = parts.length - 1; index > 0; index--) {
          const other = crypto.randomInt(index + 1);
          [parts[index], parts[other]] = [parts[other], parts[index]];
        }
        loginId = parts.join("");
      }
      while (occupied.has(loginId.toLowerCase()));
      return [...ids, loginId];
    });
    return loginId;
  }
  const accountPassword = (value) => {
    const password = typeof value === "string" ? value : "";
    if (!password.length || password.length > 200)
      throw fail("Enter a password of up to 200 characters.");
    return password;
  };
  const secret = () =>
    process.env.AUTH_SECRET ||
    process.env.SUPER_ADMIN_PASSWORD ||
    process.env.SUPER_ADMIN_KEY;
  const sign = async (user, sessionHours = null) => {
    if (!secret()) throw fail("Configure AUTH_SECRET before signing in.", 503);
    const hours = sessionHours ?? (await settings()).sessionHours;
    const body = Buffer.from(
      JSON.stringify({
        ...user,
        exp: Date.now() + hours * 3600000,
      }),
    ).toString("base64url");
    return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`;
  };
  async function audit(req, action, businessId = "", detail = "", redemption = null) {
    const entry = {
      id: crypto.randomUUID(),
      actor: req.user?.loginId || req.user?.email || "System",
      action,
      businessId,
      detail,
      createdAt: new Date().toISOString(),
      ...(redemption ? { redemption } : {}),
    };
    // Callers audit after their change is saved. A failed log write must not
    // turn that success into an error response that invites a duplicate retry.
    try {
      if (isMongo()) {
        await Meta.updateOne(
          { key: "audit" },
          {
            $push: { value: { $each: [entry], $position: 0, $slice: 2000 } },
            $inc: { revision: 1 },
          },
          { upsert: true },
        );
        return;
      }
      await changeMeta("audit", (records) => [entry, ...(records || [])].slice(0, 2000));
    } catch (error) {
      console.error(`Audit log write failed for "${action}":`, error.message);
    }
  }
  async function getBusiness(id) {
    const business = isMongo()
      ? await Business.findOne({ businessId: id, status: { $ne: "deleted" } }).lean()
      : (await listBusinesses()).find((item) => item.businessId === id);
    if (!business) throw fail("Business not found.", 404);
    return business;
  }
  async function resolveRedemptionRecord(card, metadata) {
    const meta = metadata || await readMeta(["users", "audit"]);
    const branchStaff = (meta.users || []).filter((item) =>
      item.businessId === card.businessId
      && item.role === "branch-staff");
    const recordedStaff = branchStaff.find((item) => item.id === card.staffRedeemedBy);
    const couponCode = String(card.couponCode || "").toUpperCase();
    const auditEntry = (meta.audit || []).find((item) =>
      item.businessId === card.businessId
      && item.action === "Coupon redeemed by branch staff"
      && (item.redemption ? item.redemption.slug === card.slug
        : String(item.detail || "").toUpperCase().startsWith(`${couponCode} · `)));
    if (auditEntry?.redemption) return auditEntry.redemption;
    const auditedStaff = auditEntry
      ? branchStaff.find((item) =>
          String(item.loginId || item.email || "").toLowerCase()
          === String(auditEntry.actor || "").toLowerCase())
      : null;
    // Older records may contain the last viewer's identity. Their original audit
    // actor takes precedence; never substitute the currently logged-in staff.
    const staff = auditedStaff || recordedStaff;
    const savedIdentityMatchesBranch = !auditedStaff || auditedStaff.id === card.staffRedeemedBy;
    const branchId = savedIdentityMatchesBranch
      ? String(card.staffRedeemedBranchId || card.redeemedBranchId || card.branchId || "")
      : String(auditedStaff?.branchId || card.staffRedeemedBranchId || card.branchId || "");
    return {
      branchId,
      staffId: staff?.id || card.staffRedeemedBy || "",
      branchName: savedIdentityMatchesBranch ? card.staffRedeemedBranchName : "",
      locationName: savedIdentityMatchesBranch ? card.staffRedeemedLocationName : "",
      staffName: (savedIdentityMatchesBranch ? card.staffRedeemedByName : "") || staff?.name
        || "Unknown staff member",
      redeemedAt: savedIdentityMatchesBranch
        ? card.staffRedeemedAt
        : auditEntry?.createdAt || card.staffRedeemedAt,
    };
  }
  async function updateBusiness(id, patch) {
    if (isMongo())
      return Business.findOneAndUpdate(
        { businessId: id },
        { $set: patch },
        { new: true },
      ).lean();
    const items = await readBusinesses(),
      index = items.findIndex((item) => item.businessId === id);
    if (index === -1) throw fail("Business not found.", 404);
    items[index] = {
      ...items[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await writeBusinesses(items);
    return items[index];
  }
  const scope = (req) => {
    const candidates = [
      req.params.businessId,
      req.query.business,
      req.body?.businessId,
    ]
      .filter(Boolean)
      .map((value) => text(value, 60));
    if (new Set(candidates).size > 1)
      throw fail(
        "Business selection does not match the requested workspace.",
        403,
      );
    const id = candidates[0] || "";
    if (req.user.role !== "super-admin" && id && id !== req.user.businessId)
      throw fail("Access to another business is denied.", 403);
    return req.user.role === "super-admin" ? id : req.user.businessId;
  };
  const owner = (req) => {
    if (!["super-admin", "business", "admin"].includes(req.user.role))
      throw fail("Administrator permission is required.", 403);
  };
  const superOnly = (req, res, next) =>
    req.user.role === "super-admin"
      ? next()
      : res.status(403).json({ message: "Super-admin access is required." });
  const route = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
  const authenticate = route(async (req, res) => {
    const [body, signature] = String(req.get("authorization") || "")
      .replace(/^Bearer\s+/i, "")
      .split(".");
    if (
      !secret() ||
      !body ||
      !signature ||
      !equal(
        signature,
        crypto.createHmac("sha256", secret()).update(body).digest("base64url"),
      )
    )
      throw fail("Please sign in again.", 401);
    let user;
    try {
      user = JSON.parse(Buffer.from(body, "base64url").toString());
    } catch {
      throw fail("Invalid session.", 401);
    }
    if (!Number.isFinite(user.exp) || user.exp < Date.now())
      throw fail("Your session has expired.", 401);
    const metaKeys = ["versions"];
    if (user.role === "super-admin" && user.id !== "super-admin")
      metaKeys.push("superAdmins");
    if (user.role !== "super-admin") {
      metaKeys.push("settings");
      if (user.role !== "business") metaKeys.push("users");
    }
    const meta = await readMeta(metaKeys);
    if ((user.version || 0) !== (meta.versions?.[user.id] || 0))
      throw fail("This session was revoked. Please sign in again.", 401);
    if (
      !["super-admin", "business", "admin", "editor", "viewer", "branch-staff"].includes(
        user.role,
      )
    )
      throw fail("Invalid account role.", 401);
    if (user.role === "super-admin" && user.id !== "super-admin") {
      const account = (meta.superAdmins || []).find((item) => item.id === user.id && item.status === "active");
      if (!account) throw fail("Account access is suspended.", 403);
      user.name = account.name;
    } else if (user.role !== "super-admin") {
      let business;
      try {
        business = await getBusiness(user.businessId);
      } catch (error) {
        if (error.status === 404)
          throw fail("This business is no longer available. Please sign in again.", 401);
        throw error;
      }
      if (user.role === "business" && (user.passwordVersion || "") !== (business.passwordVersion || ""))
        throw fail("Your password changed. Please sign in again.", 401);
      const memberAccess = meta.settings?.memberAccess ?? defaults.memberAccess;
      if (business.status !== "active" || !memberAccess)
        throw fail("Business access is paused.", 403);
      if (user.role !== "business") {
        const account = (meta.users || []).find(
          (item) => item.id === user.id && item.status === "active",
        );
        if (!account) throw fail("Account access is suspended.", 403);
        user.role = account.role;
        user.name = account.name;
        user.branchId = account.branchId || "";
        if (account.role === "branch-staff") {
          const branch = business.branches?.find((item) =>
            item.branchId === account.branchId && item.status === "active");
          if (!branch) throw fail("Branch access is paused or unavailable.", 403);
        }
      }
    }
    req.user = user;
    // Middleware continues after authentication, using the same persisted permissions.
    req.authenticated = true;
  });
  const auth = (req, res, next) =>
    authenticate(req, res, (error) => next(error)).then(() => {
      if (req.authenticated && !res.headersSent) next();
    });
  async function cardRows(req) {
    const id = scope(req),
      visibleBusinesses = id
        ? new Set([id])
        : new Set((await listBusinesses()).map((business) => business.businessId)),
      query =
        id === "impact-vibes"
          ? { $or: [{ businessId: id }, { businessId: { $exists: false } }] }
          : id
            ? { businessId: id }
            : {};
    const cards = isMongo()
      ? await Card.find(query).select("-shareImageBase64").sort({ createdAt: -1 }).lean()
      : await readLocalCards();
    const visibleCards = cards
      .filter((item) => visibleBusinesses.has(item.businessId || "impact-vibes"))
      .filter((item) => !id || (item.businessId || "impact-vibes") === id)
      .filter((item) => req.user.role === "super-admin" || !item.deletedAt)
      .filter((item) => req.user.role !== "branch-staff"
        // Staff need completed records for their existing history and metrics,
        // never the inventory of available, opened, or scratched coupon codes.
        || (Boolean(item.staffRedeemedAt) && (item.branchId === req.user.branchId
          || item.staffRedeemedBranchId === req.user.branchId)));
    // Resolve saved redemption identities once per list, not from the viewer's
    // login or the coupon's original assignment. Reuse metadata for legacy rows.
    const redemptionMeta = visibleCards.some(item => item.staffRedeemedAt)
      ? await readMeta(["users", "audit"]) : null;
    const redemptionBusinesses = redemptionMeta ? await listBusinesses() : [];
    return (await Promise.all(visibleCards.map(async (item) => {
        // The potentially large preview payload is only served through the
        // public image endpoint and must not inflate authenticated tables.
        const { shareImageBase64: _image, shareImageMime, ...row } = item;
        let redemptionDetails = null;
        if (item.staffRedeemedAt) {
          const record = await resolveRedemptionRecord({ ...item, businessId: item.businessId || "impact-vibes" }, redemptionMeta);
          const business = redemptionBusinesses.find(value => value.businessId === (item.businessId || "impact-vibes"));
          const unit = business?.branches?.find(value => value.branchId === record.branchId);
          const location = business?.departments?.find(value => value.departmentId === unit?.departmentId);
          redemptionDetails = {
            staffId: record.staffId || "",
            staffName: record.staffName || "Unknown staff member",
            branchName: record.locationName || location?.name || "Unknown branch",
            departmentName: record.branchName || unit?.name || "Unknown department",
            redeemedAt: record.redeemedAt || item.staffRedeemedAt,
          };
        }
        return {
          ...row,
          redemptionDetails,
          hasShareImage: Boolean(_image),
          shareImageMime: shareImageMime || null,
          businessId: item.businessId || "impact-vibes",
          used: Boolean(item.staffRedeemedAt),
          revealed: Boolean(item.scratchedAt || item.redeemedAt || item.staffRedeemedAt),
          status: couponStatus(item),
        };
      })))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  async function limit(business, resource, count) {
    const maximum = (await businessLimits(business))[resource];
    if (maximum > 0 && count >= maximum)
      throw fail(
        `${resource} limit reached (${maximum}). Contact your administrator.`,
        403,
      );
  }

  app.get(
    "/api/platform",
    route(async (_req, res) => {
      const config = await settings();
      res.json({
        platformName: config.platformName,
        supportEmail: config.supportEmail,
        supportUrl: config.supportUrl,
        loginMessage: config.loginMessage,
      });
    }),
  );
  // Count failed sign-ins per address and per login ID. The address bucket
  // slows password spraying; the login ID bucket protects each account even
  // if a client rotates addresses. Successful sign-ins use neither allowance.
  const LOGIN_WINDOW_MS = 15 * 60000;
  const LOGIN_FAILURE_LIMITS = { ip: 30, id: 10 };
  const loginFailures = new Map();
  const loginKeys = (req, loginId) =>
    [`ip:${req.ip || "unknown"}`, ...(loginId ? [`id:${loginId}`] : [])];
  const loginRetryAfter = (keys, now = Date.now()) => Math.max(0, ...keys.map((key) => {
    const bucket = loginFailures.get(key);
    return bucket && bucket.until > now && bucket.count >= LOGIN_FAILURE_LIMITS[key.split(":")[0]]
      ? bucket.until - now : 0;
  }));
  const recordLoginFailure = (keys, now = Date.now()) => {
    if (loginFailures.size >= 20000) {
      for (const [key, bucket] of loginFailures) if (bucket.until <= now) loginFailures.delete(key);
      // Random login IDs must not grow memory without bound; drop the oldest.
      for (const key of loginFailures.keys()) {
        if (loginFailures.size < 19000) break;
        loginFailures.delete(key);
      }
    }
    for (const key of keys) {
      const bucket = loginFailures.get(key);
      if (bucket && bucket.until > now) bucket.count++;
      else loginFailures.set(key, { count: 1, until: now + LOGIN_WINDOW_MS });
    }
  };
  app.post(
    "/api/auth/login",
    route(async (req, res) => {
      const email = text(req.body.loginId ?? req.body.email).toLowerCase(),
        password = String(req.body.password || ""),
        throttleKeys = loginKeys(req, email);
      const wait = loginRetryAfter(throttleKeys);
      if (wait) {
        const minutes = Math.ceil(wait / 60000);
        res.set("Retry-After", String(Math.ceil(wait / 1000)));
        throw fail(`Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, 429);
      }
      const meta = await readMeta(["adminPasswordHash", "superAdmins", "users", "versions", "settings"]);
      let user = password && password.length <= 200 ? await matchLogin(email, password, meta) : null;
      if (!user) {
        recordLoginFailure(throttleKeys);
        throw fail("Invalid login ID or password.", 401);
      }
      if (user.role !== "super-admin") {
        const loginBusiness = await getBusiness(user.businessId);
        const loginSettings = { ...defaults, ...(meta.settings || {}) };
        if (loginBusiness.status !== "active" || !loginSettings.memberAccess)
          throw fail("Business access is paused.", 403);
        if (user.role === "branch-staff" && !loginBusiness.branches?.some((item) =>
          item.branchId === user.branchId && item.status === "active"))
          throw fail("Branch access is paused or unavailable.", 403);
      }
      loginFailures.delete(`id:${email}`);
      if (user.role === "branch-staff") {
        const lastLoginAt = new Date().toISOString();
        user = { ...user, lastLoginAt, loginCount: Number(user.loginCount || 0) + 1 };
        // Login statistics are informational; never refuse a valid sign-in for them.
        await changeMeta("users", (records = []) => records.map((item) =>
          item.id === user.id ? { ...item, lastLoginAt, loginCount: user.loginCount } : item))
          .catch((error) => console.error("Could not record branch staff sign-in:", error.message));
      }
      user.version = meta.versions?.[user.id] || 0;
      req.user = user;
      await audit(req, "Signed in", user.businessId);
      const sessionHours = Number(meta.settings?.sessionHours) || defaults.sessionHours;
      res.set("Cache-Control", "no-store").json({ token: await sign(user, sessionHours), user });
    }),
  );
  // Returns the account whose credentials match, or null. Access rules are
  // checked by the caller, so a correct password never counts as a failure.
  async function matchLogin(loginId, password, meta) {
    if (loginId === primaryLogin()) {
      const valid = meta.adminPasswordHash
        ? verifyPassword(password, meta.adminPasswordHash)
        : Boolean(secret()) && equal(password,
          String(process.env.SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_KEY || ""));
      if (valid) return { id: "super-admin", role: "super-admin", name: "Super admin", email: loginId };
    }
    const admin = (meta.superAdmins || []).find((item) =>
      String(item.loginId || "").toLowerCase() === loginId && item.status === "active");
    if (admin && verifyPassword(password, admin.passwordHash)) return safe(admin);
    const business = (await listBusinesses()).find(
      (item) => String(item.loginId || item.loginEmail || "").toLowerCase() === loginId,
    );
    if (business && verifyPassword(password, business.passwordHash))
      return {
        id: business.businessId,
        role: "business",
        businessId: business.businessId,
        name: business.name,
        email: loginId,
        passwordVersion: business.passwordVersion || "",
        ...(business.loginId ? { loginId: business.loginId } : {}),
      };
    const account = (meta.users || []).find(
      (item) => String(item.loginId || item.email || "").toLowerCase() === loginId && item.status === "active",
    );
    return account && verifyPassword(password, account.passwordHash) ? safe(account) : null;
  }
  app.get(
    "/api/auth/me",
    auth,
    route(async (req, res) => {
      let user = req.user;
      if (user.role !== "super-admin") {
        const business = await getBusiness(user.businessId);
        user = {
          ...user,
          name: user.role === "business" ? business.name : user.name,
        };
      }
      res.json({ user });
    }),
  );
  app.post(
    "/api/auth/logout",
    auth,
    route(async (req, res) => {
      await changeMeta("versions", (values) => ({
        ...values,
        [req.user.id]: (values?.[req.user.id] || 0) + 1,
      }));
      await audit(req, "Signed out", req.user.businessId);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/portal/super-admins",
    auth,
    superOnly,
    route(async (_req, res) => {
      res.json({ users: [
        { id: "super-admin", name: "Primary super admin", loginId: primaryLogin(), role: "super-admin", status: "active", primary: true },
        ...((await readMeta(["superAdmins"])).superAdmins || []).map(safe),
      ] });
    }),
  );
  app.post(
    "/api/portal/super-admins",
    auth,
    superOnly,
    route(async (req, res) => {
      const name = text(req.body.name, 60);
      if (!name) throw fail("Full name is required.");
      const password = accountPassword(req.body.password),
        credentials = { loginId: await issueLoginId(), password };
      const user = { id: crypto.randomUUID(), name, loginId: credentials.loginId,
        passwordHash: hashPassword(password), role: "super-admin",
        status: "active", createdAt: new Date().toISOString() };
      await changeMeta("superAdmins", (records = []) => [...records, user]);
      await audit(req, "Super-admin account created", "", user.loginId);
      res.set("Cache-Control", "no-store").status(201).json({ user: safe(user), credentials });
    }),
  );
  app.patch(
    "/api/portal/super-admins/:userId",
    auth,
    superOnly,
    route(async (req, res) => {
      if (req.params.userId === "super-admin" || req.params.userId === req.user.id)
        throw fail("You cannot pause your own account or the primary super admin.");
      if (!["active", "paused"].includes(req.body.status)) throw fail("Invalid status.");
      await changeMeta("superAdmins", (records = []) => {
        if (!records.some((item) => item.id === req.params.userId)) throw fail("Account not found.", 404);
        return records.map((item) => item.id === req.params.userId ? { ...item, status: req.body.status } : item);
      });
      await changeMeta("versions", (values) => ({ ...values, [req.params.userId]: (values?.[req.params.userId] || 0) + 1 }));
      await audit(req, "Super-admin account access updated", "", req.params.userId);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/portal/cards",
    auth,
    route(async (req, res) => res.json({ cards: await cardRows(req) })),
  );
  app.get(
    "/api/portal/businesses",
    auth,
    route(async (req, res) => {
      const items = (await listBusinesses()).filter(
        (item) =>
          req.user.role === "super-admin" ||
          item.businessId === req.user.businessId,
      );
      const legacy = await legacyPlans();
      res.json({
        businesses: await Promise.all(
          items.map(async (item) => {
            const result = safe(item);
            if (req.user.role !== "super-admin") {
              result.departments = (result.departments || []).filter((value) => value.status !== "deleted");
              result.branches = (result.branches || []).filter((value) => value.status !== "deleted");
            }
            if (req.user.role === "branch-staff") {
              result.branches = (result.branches || []).filter((value) => value.branchId === req.user.branchId);
              const departmentIds = new Set(result.branches.map((value) => value.departmentId).filter(Boolean));
              result.departments = (result.departments || []).filter((value) => departmentIds.has(value.departmentId));
              delete result.loginId;
              delete result.loginEmail;
              delete result.passwordVersion;
            }
            return { ...result, limits: await businessLimits(item, legacy) };
          }),
        ),
      });
    }),
  );
  app.get(
    "/api/portal/businesses/:businessId/accounts-export",
    auth,
    superOnly,
    route(async (req, res) => {
      const id = scope(req), business = await getBusiness(id);
      const accounts = [{
        name: business.name,
        role: "Business owner",
        branch: "All brands",
        department: "All departments",
        loginId: business.loginId || business.loginEmail || "Not configured",
        password: "Not retrievable",
        status: business.status || "active",
      }];
      const roles = { admin: "Administrator", editor: "Editor", viewer: "Viewer", "branch-staff": "Department staff" };
      for (const user of (await users()).filter(item => item.businessId === id && item.status !== "deleted")) {
        const unit = business.branches?.find(item => item.branchId === user.branchId);
        const location = business.departments?.find(item => item.departmentId === unit?.departmentId);
        // Explicit fields only: never serialize hashes, sessions, or password versions.
        accounts.push({
          name: user.name || "",
          role: roles[user.role] || user.role,
          branch: user.branchId ? location?.name || "Unassigned" : "All brands",
          department: user.branchId ? unit?.name || "Unavailable department" : "All departments",
          loginId: user.loginId || user.email || "Not configured",
          password: "Not retrievable",
          status: user.status || "active",
        });
      }
      await audit(req, "Business accounts exported", id, `${accounts.length} accounts; passwords not included`);
      res.set("Cache-Control", "private, no-store").json({
        business: { businessId: id, name: business.name },
        passwordNotice: "Existing passwords are stored as one-way hashes and cannot be recovered. No passwords were changed by this export.",
        accounts,
      });
    }),
  );
  app.post(
    "/api/portal/businesses",
    auth,
    superOnly,
    route(async (req, res) => {
      const name = text(req.body.name, 60),
        loginBased = req.body.generateCredentials === true || req.body.loginId !== undefined || !req.body.loginEmail;
      if (!name) throw fail("Business name is required.");
      const limits = validateLimits(req.body.limits), website = safeUrl(req.body.website);
      const structureMode = req.body.structureMode ?? "branch-department";
      if (!["branch", "brand", "branch-only", "branch-department", "brand-department", "brand-only"].includes(structureMode))
        throw fail("Choose a valid workspace structure.");
      if (req.body.cardImagesEnabled !== undefined && typeof req.body.cardImagesEnabled !== "boolean")
        throw fail("Choose whether card images are enabled.");
      const cardImagesEnabled = req.body.cardImagesEnabled !== false;
      const password = loginBased ? accountPassword(req.body.password) : String(req.body.password || ""),
        requestedLoginId = String(req.body.loginId || "").trim(),
        credentials = loginBased ? {
          loginId: requestedLoginId ? await reserveLoginId(requestedLoginId) : await issueLoginId(),
          password,
        } : null;
      const email = text(req.body.loginEmail).toLowerCase(),
        normalizedPassword = credentials?.password || password;
      if (
        (!loginBased && !/^\S+@\S+\.\S+$/.test(email)) ||
        (!loginBased && normalizedPassword.length < 10) ||
        normalizedPassword.length > 200
      )
        throw fail(
          "Business name, valid email and a password of at least 10 characters are required.",
        );
      if (!loginBased && (
        (await listBusinesses()).some((item) => item.loginEmail === email) ||
        (await users()).some((item) => item.email === email) ||
        email === primaryLogin()
      ))
        throw fail("This login email already exists.", 409);
      const business = {
        businessId: `biz_${crypto.randomBytes(6).toString("hex")}`,
        name,
        ...(loginBased ? { loginId: credentials.loginId } : { loginEmail: email }),
        passwordHash: hashPassword(normalizedPassword),
        website,
        status: "active",
        departments: [],
        branches: [],
        limits,
        structureMode,
        cardImagesEnabled,
        brand: {},
        createdAt: new Date().toISOString(),
      };
      if (isMongo()) await Business.create(business);
      else {
        const items = await readBusinesses();
        items.push(business);
        await writeBusinesses(items);
      }
      await audit(req, "Business created", business.businessId, name);
      res.set("Cache-Control", "no-store").status(201).json({ business: safe(business), ...(credentials ? { credentials } : {}) });
    }),
  );
  app.patch(
    "/api/portal/businesses/:businessId",
    auth,
    route(async (req, res) => {
      const id = scope(req);
      owner(req);
      const business = await getBusiness(id),
        patch = {};
      if (req.body.loginId !== undefined && req.user.role !== "super-admin")
        throw fail("Only the super administrator can change a business login ID.", 403);
      if (req.body.password !== undefined && req.user.role !== "super-admin")
        throw fail("Only the super administrator can reset a business password.", 403);
      if (req.body.limits !== undefined && req.user.role !== "super-admin")
        throw fail(
          "Only the super administrator can change business limits.",
          403,
        );
      if ((req.body.structureMode !== undefined || req.body.cardImagesEnabled !== undefined)
        && req.user.role !== "super-admin")
        throw fail("Only the super administrator can change workspace configuration.", 403);
      if (req.body.planId !== undefined && req.body.planId !== business.planId)
        throw fail(
          "Set limits directly on the business instead of assigning a plan.",
        );
      if (req.body.name !== undefined) {
        if (!["super-admin", "business"].includes(req.user.role))
          throw fail("Only the business owner or super administrator can change the business name.", 403);
        patch.name = text(req.body.name, 60);
        if (!patch.name) throw fail("Business name is required.");
      }
      if (req.user.role === "super-admin") {
        if (req.body.loginId !== undefined) {
          const currentLoginId = business.loginId || business.loginEmail || "";
          const requestedLoginId = String(req.body.loginId || "").trim();
          const nextLoginId = requestedLoginId
            ? validateLoginId(requestedLoginId)
            : await issueLoginId();
          if (nextLoginId.toLowerCase() !== currentLoginId.toLowerCase()) {
            patch.loginId = requestedLoginId
              ? await reserveLoginId(nextLoginId, {
                current: currentLoginId,
                excludeBusinessId: id,
              })
              : nextLoginId;
            await changeMeta("versions", (values) => ({
              ...values,
              [id]: (values?.[id] || 0) + 1,
            }));
          }
        }
        if (
          req.body.loginEmail !== undefined &&
          req.body.loginEmail !== business.loginEmail && !business.loginId
        ) {
          const email = text(req.body.loginEmail).toLowerCase();
          if (!/^\S+@\S+\.\S+$/.test(email))
            throw fail("Enter a valid owner email.");
          if (
            (await listBusinesses()).some(
              (item) => item.businessId !== id && item.loginEmail === email,
            ) ||
            (await users()).some((item) => item.email === email) ||
            email === primaryLogin()
          )
            throw fail("This login email already exists.", 409);
          patch.loginEmail = email;
          await changeMeta("versions", (values) => ({
            ...values,
            [id]: (values?.[id] || 0) + 1,
          }));
        }
        if (req.body.status !== undefined) {
          if (!["active", "paused"].includes(req.body.status))
            throw fail("Invalid status.");
          patch.status = req.body.status;
        }
        if (req.body.limits !== undefined)
          patch.limits = validateLimits(req.body.limits);
        if (req.body.structureMode !== undefined) {
          if (!["branch", "brand", "branch-only", "branch-department", "brand-department", "brand-only"].includes(req.body.structureMode))
            throw fail("Choose a valid workspace structure.");
          if (req.body.structureMode === "brand-only") {
            const activeDepartments = (business.departments || []).filter(item => item.status !== "deleted");
            const activeBranches = (business.branches || []).filter(item => item.status !== "deleted");
            const names = activeDepartments.map(item => item.name.trim().toLowerCase());
            if (activeBranches.some(item => !activeDepartments.some(parent => parent.departmentId === item.departmentId))
              || activeDepartments.some(parent => activeBranches.filter(item => item.departmentId === parent.departmentId).length !== 1)
              || new Set(names).size !== names.length)
              throw fail("Brand-only needs exactly one active redemption unit per brand and no unassigned units. Reorganize this business before switching.", 409);
            patch.branches = (business.branches || []).map(item => {
              const parent = activeDepartments.find(value => value.departmentId === item.departmentId);
              return parent && item.status !== "deleted" ? { ...item, name: parent.name } : item;
            });
          }
          patch.structureMode = req.body.structureMode;
        }
        if (req.body.cardImagesEnabled !== undefined) {
          if (typeof req.body.cardImagesEnabled !== "boolean")
            throw fail("Choose whether card images are enabled.");
          patch.cardImagesEnabled = req.body.cardImagesEnabled;
        }
        if (req.body.password !== undefined) {
          if (typeof req.body.password !== "string" || req.body.password.length < 10 || req.body.password.length > 200)
            throw fail("Use a password of 10–200 characters.");
          patch.passwordHash = hashPassword(req.body.password);
          // Save the credential version with the hash so even an in-flight login
          // verified against the old password cannot create a usable session.
          patch.passwordVersion = crypto.randomUUID();
          await changeMeta("versions", (values) => ({
            ...values,
            [id]: (values?.[id] || 0) + 1,
          }));
        }
      }
      if (req.body.website !== undefined)
        patch.website = safeUrl(req.body.website);
      if (req.body.brand) {
        patch.brand = {};
        for (const key of ["pageColor", "textColor", "accentColor"])
          if (/^#[0-9a-f]{6}$/i.test(req.body.brand[key]))
            patch.brand[key] = req.body.brand[key];
      }
      await updateBusiness(business.businessId, patch);
      await audit(
        req,
        patch.passwordHash ? "Business password reset" : "Business settings updated",
        id,
        Object.keys(patch)
          .filter((key) => !["passwordHash", "passwordVersion"].includes(key))
          .join(", "),
      );
      res.json({ ok: true });
    }),
  );
  app.patch("/api/portal/businesses/:businessId/brand-settings", auth, route(async (req, res) => {
    owner(req);
    const id = scope(req), business = await getBusiness(id);
    const fixed = await saveBrand(req.body.fixed, business.brandSettings?.fixed);
    await updateBusiness(id, {
      brandSettings: { ...business.brandSettings, fixed },
      ...(fixed.image ? { cardImagesEnabled: true } : {}),
    });
    await audit(req, "Fixed brand updated", id, fixed.name || "Fixed branding removed");
    res.json({ ok: true, fixed });
  }));
  app.patch("/api/portal/businesses/:businessId/brand-settings/:departmentId", auth, route(async (req, res) => {
    owner(req);
    const id = scope(req), business = await getBusiness(id);
    const current = business.departments?.find(item => item.departmentId === req.params.departmentId && item.status !== "deleted");
    if (!current) throw fail("Brand not found.", 404);
    const brand = await saveBrand(req.body, current);
    if (!brand.name) throw fail("Brand name is required.");
    if (business.structureMode === "brand-only" && business.departments.some(item => item.departmentId !== current.departmentId
      && item.status !== "deleted" && item.name.toLowerCase() === brand.name.toLowerCase()))
      throw fail("This brand name already exists in the business.", 409);
    await updateBusiness(id, {
      departments: business.departments.map(item => item.departmentId === current.departmentId ? { ...item, ...brand } : item),
      ...(brand.image ? { cardImagesEnabled: true } : {}),
      ...(business.structureMode === "brand-only" && brand.name !== current.name ? {
        branches: (business.branches || []).map(item => item.departmentId === current.departmentId && item.status !== "deleted"
          ? { ...item, name: brand.name } : item),
      } : {}),
    });
    await audit(req, "Brand configuration updated", id, brand.name);
    res.json({ ok: true, brand });
  }));
  app.delete(
    "/api/portal/businesses",
    auth,
    superOnly,
    route(async (req, res) => {
      if (req.body?.confirmText !== "DELETE ALL BUSINESSES")
        throw fail("Type DELETE ALL BUSINESSES to confirm.");
      const businesses = await listBusinesses();
      const ids = req.body.businessIds;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") ||
          ids.length !== businesses.length || new Set(ids).size !== ids.length ||
          !businesses.every((business) => ids.includes(business.businessId)))
        throw fail("The business list changed. Refresh it and confirm deletion again.", 409);
      if (!businesses.length) return res.json({ ok: true, archived: true, deletedCount: 0 });
      const patch = { status: "deleted", deletedAt: new Date().toISOString() };
      if (isMongo())
        await Business.updateMany({ businessId: { $in: ids }, status: { $ne: "deleted" } }, { $set: patch });
      else {
        const targets = new Set(ids);
        await writeBusinesses((await readBusinesses()).map((business) =>
          targets.has(business.businessId) ? { ...business, ...patch } : business));
      }
      await audit(req, "All businesses deleted", "", text(businesses.map((business) => business.name).join(", "), 1000));
      res.json({ ok: true, archived: true, deletedCount: businesses.length });
    }),
  );
  app.delete(
    "/api/portal/businesses/:businessId/cards/:slug",
    auth,
    route(async (req, res) => {
      owner(req);
      const id = scope(req);
      const business = await getBusiness(id);
      const slug = text(req.params.slug, 80);
      const cards = await cardRows(req);
      const card = cards.find((item) => item.businessId === id && item.slug === slug);
      if (!card) throw fail("Coupon not found.", 404);
      if (String(req.body?.confirmCode || "").trim().toUpperCase() !== String(card.couponCode).toUpperCase())
        throw fail("Type the exact coupon code to confirm deletion.");
      // Business deletion archives the record. Only super admins may erase it.
      if (req.user.role !== "super-admin") {
        const patch = { deletedAt: new Date().toISOString(), deletedBy: req.user.id };
        if (isMongo()) {
          const result = await Card.updateOne({ slug: card.slug, deletedAt: null }, { $set: patch });
          if (!result.matchedCount) throw fail("Coupon not found.", 404);
        } else await mutateLocalCards((items) => {
          const current = items.find(item => item.slug === card.slug && (item.businessId || "impact-vibes") === id && !item.deletedAt);
          if (!current) throw fail("Coupon not found.", 404);
          Object.assign(current, patch);
        });
        await audit(req, "Business coupon archived", id, `${business.name}: ${card.couponCode} (retained for super-admin recovery)`);
        return res.json({ ok: true, archived: true, deletedCount: 1 });
      }
      let deletedCount = 0;
      if (isMongo()) {
        const query = id === "impact-vibes"
          ? { slug: card.slug, $or: [{ businessId: id }, { businessId: { $exists: false } }] }
          : { slug: card.slug, businessId: id };
        deletedCount = (await Card.deleteOne(query)).deletedCount;
      }
      else
        deletedCount = await mutateLocalCards((items) => {
          const index = items.findIndex((item) =>
            item.slug === card.slug && (item.businessId || "impact-vibes") === id);
          if (index === -1) return 0;
          items.splice(index, 1);
          return 1;
        });
      if (!deletedCount) throw fail("Coupon not found.", 404);
      await audit(req, "Business coupon deleted", id,
        `${business.name}: ${card.couponCode} permanently deleted`);
      res.json({ ok: true, deletedCount: 1 });
    }),
  );
  app.post(
    "/api/portal/businesses/:businessId/cards/:slug/restore",
    auth,
    superOnly,
    route(async (req, res) => {
      const id = scope(req);
      const business = await getBusiness(id);
      const card = (await cardRows(req)).find(item => item.businessId === id && item.slug === req.params.slug);
      if (!card) throw fail("Coupon not found.", 404);
      if (!card.deletedAt) throw fail("Coupon is not deleted.", 409);
      if (String(req.body?.confirmCode || "").trim().toUpperCase() !== String(card.couponCode).toUpperCase())
        throw fail("Type the exact coupon code to confirm restoration.");
      if (isMongo()) {
        const result = await Card.updateOne({ slug: card.slug, deletedAt: { $ne: null } },
          { $set: { deletedAt: null, deletedBy: "" } });
        if (!result.matchedCount) throw fail("Coupon could not be restored. Refresh and try again.", 409);
      } else await mutateLocalCards((items) => {
        const current = items.find(item => item.slug === card.slug && (item.businessId || "impact-vibes") === id);
        if (!current?.deletedAt) throw fail("Coupon could not be restored. Refresh and try again.", 409);
        delete current.deletedAt;
        delete current.deletedBy;
      });
      await audit(req, "Business coupon restored", id, `${business.name}: ${card.couponCode}`);
      res.json({ ok: true, restored: true });
    }),
  );
  app.delete(
    "/api/portal/businesses/:businessId/cards",
    auth,
    route(async (req, res) => {
      owner(req);
      const id = scope(req);
      const business = await getBusiness(id);
      if (req.body?.confirmName !== business.name)
        throw fail("Type the exact business name to confirm coupon deletion.");
      const slugs = req.body.couponSlugs, expectedCount = req.body.confirmCount;
      if (!Array.isArray(slugs) || !Number.isSafeInteger(expectedCount) || expectedCount < 0
        || slugs.length !== expectedCount || new Set(slugs).size !== slugs.length
        || slugs.some(slug => typeof slug !== "string" || !/^[A-Za-z0-9_-]{6,32}$/.test(slug)))
        throw fail("Confirm the coupon count and list before deleting all coupons.");
      const permanent = req.user.role === "super-admin";
      const filtered = req.body.selectionMode === "filtered";
      if (req.body.selectionMode !== undefined && !["all", "filtered"].includes(req.body.selectionMode))
        throw fail("Choose a valid coupon deletion selection.");
      const expected = new Set(slugs);
      const states = req.body.couponStates;
      if (filtered && (!Array.isArray(states) || states.length !== expectedCount
        || states.some(state => !state || !expected.has(state.slug) || !COUPON_STATUSES.includes(state.status))
        || new Set(states.map(state => state.slug)).size !== expectedCount))
        throw fail("Confirm the matching coupon states before deleting coupons.");
      const expectedStates = new Map(filtered ? states.map(state => [state.slug, state.status]) : []);
      const checkTargets = (items) => {
        const current = items.filter(item => (item.businessId || "impact-vibes") === id && (permanent || !item.deletedAt)
          && (!filtered || expected.has(item.slug)));
        if (current.length !== expectedCount || current.some(item => !expected.has(item.slug)
          || (filtered && couponStatus(item) !== expectedStates.get(item.slug))))
          throw fail("The coupon list changed. Refresh and confirm deletion again.", 409);
        return current;
      };
      const targets = checkTargets(await cardRows(req));
      const query = id === "impact-vibes"
        ? { slug: { $in: slugs }, $or: [{ businessId: id }, { businessId: { $exists: false } }] }
        : { businessId: id, slug: { $in: slugs } };
      if (filtered && targets.length) {
        // Match the saved lifecycle atomically too: a concurrent redemption or
        // restore must never be erased using a stale status-filter snapshot.
        query.$and = [{ $or: targets.map(card => ({ slug: card.slug,
          disabled: card.disabled ? true : { $ne: true },
          ...Object.fromEntries(["deletedAt", "staffRedeemedAt", "expiresAt", "scratchedAt", "redeemedAt", "openedAt"]
            .map(field => [field, card[field] || null])),
        })) }];
      }
      const archive = { deletedAt: new Date().toISOString(), deletedBy: req.user.id };
      let deletedCount = 0;
      if (isMongo()) {
        if (permanent) {
          const batchKeys = filtered ? [...new Set(targets.map(card => card.batchKey).filter(Boolean))]
            : CouponBatch ? await CouponBatch.distinct("key", { businessId: id }) : [];
          deletedCount = (await Card.deleteMany(query)).deletedCount;
          // Never remove metadata for a newer batch outside this confirmation.
          if (CouponBatch && batchKeys.length) {
            const remaining = new Set(await Card.distinct("batchKey", { businessId: id, batchKey: { $in: batchKeys } }));
            await CouponBatch.deleteMany({ businessId: id, key: { $in: batchKeys.filter(key => !remaining.has(key)) } });
          }
        } else deletedCount = (await Card.updateMany({ ...query, deletedAt: null }, { $set: archive })).modifiedCount;
      } else {
        deletedCount = await mutateLocalCards((items) => {
          checkTargets(items);
          let removed = 0;
          for (let index = items.length - 1; index >= 0; index -= 1) {
            if ((items[index].businessId || "impact-vibes") === id && expected.has(items[index].slug)) {
              if (permanent) items.splice(index, 1);
              else Object.assign(items[index], archive);
              removed += 1;
            }
          }
          return removed;
        });
      }
      await audit(req, permanent ? `${filtered ? "Selected" : "All"} business coupons deleted`
        : `${filtered ? "Selected" : "All"} business coupons archived`, id,
        `${business.name}: ${deletedCount} coupons ${permanent ? "permanently deleted" : "archived for super-admin recovery"}`);
      res.json({ ok: true, archived: !permanent, deletedCount, businessId: id, businessName: business.name });
    }),
  );
  app.delete(
    "/api/portal/businesses/:businessId",
    auth,
    superOnly,
    route(async (req, res) => {
      const id = scope(req);
      const business = await getBusiness(id);
      if (req.body?.confirmName !== business.name)
        throw fail("Type the exact business name to confirm deletion.");
      // One durable update disables the whole tenant and preserves recovery data.
      await updateBusiness(id, { status: "deleted", deletedAt: new Date().toISOString() });
      await audit(req, "Business deleted", id, `${business.name} (archived for recovery)`);
      res.json({ ok: true, archived: true });
    }),
  );
  app.post(
    "/api/portal/businesses/:businessId/departments/branches",
    auth,
    route(async (req, res) => {
      const id = scope(req);
      owner(req);
      const business = await getBusiness(id),
        currentDepartments = business.departments || [],
        currentBranches = business.branches || [],
        activeDepartments = currentDepartments.filter((item) => item.status !== "deleted"),
        activeBranches = currentBranches.filter((item) => item.status !== "deleted"),
        input = req.body?.departments;
      const structureMode = business.structureMode || "brand-department";
      if (structureMode === "branch-only") throw fail("This workspace uses branches only. Add a branch instead.");
      if (!Array.isArray(input) || input.length < 1 || input.length > 20)
        throw fail("Add between 1 and 20 departments.");
      if (structureMode === "brand-only") {
        const names = [...activeDepartments.map(item => item.name.toLowerCase()),
          ...input.map(item => text(item?.name, 60).toLowerCase())];
        if (new Set(names).size !== names.length)
          throw fail("Each brand name must be unique in this business.", 409);
      }
      const limits = await businessLimits(business);
      if (limits.department > 0 && activeDepartments.length + input.length > limits.department)
        throw fail(`department limit reached (${limits.department}). Contact your administrator.`, 403);
      let totalBranches = 0;
      const createdDepartments = [], createdBranches = [];
      for (const row of input) {
        const name = text(row?.name, 60);
        if (!name) throw fail("Every department needs a name.");
        if (!Array.isArray(row.branches) || row.branches.length < 1 || row.branches.length > 50)
          throw fail(`Add between 1 and 50 branches under ${name}.`);
        if (structureMode === "brand-only" && (row.branches.length !== 1 || text(row.branches[0]?.name, 60) !== name))
          throw fail("Brand-only configuration creates one internal redemption unit with the same name as each brand.");
        const department = { departmentId: crypto.randomUUID(), name, status: "active" };
        createdDepartments.push(department);
        for (const item of row.branches) {
          const branchName = text(item?.name, 60);
          if (!branchName) throw fail(`Every branch under ${name} needs a name.`);
          const branch = {
            branchId: crypto.randomUUID(), departmentId: department.departmentId,
            name: branchName, address: text(item?.address, 140), status: "active",
          };
          checkDepartmentName(createdBranches, branch);
          createdBranches.push(branch);
          totalBranches++;
        }
      }
      if (totalBranches > 200) throw fail("A single hierarchy can contain at most 200 branches.");
      if (limits.branch > 0 && activeBranches.length + totalBranches > limits.branch)
        throw fail(`branch limit reached (${limits.branch}). Contact your administrator.`, 403);
      await updateBusiness(id, {
        departments: [...currentDepartments, ...createdDepartments],
        branches: [...currentBranches, ...createdBranches],
      });
      await audit(req, "Departments and branches created", id,
        `${createdDepartments.length} departments, ${createdBranches.length} branches`);
      res.status(201).json({ departments: createdDepartments, branches: createdBranches });
    }),
  );
  app.post(
    "/api/portal/businesses/:businessId/branches",
    auth,
    route(async (req, res) => {
      const id = scope(req);
      owner(req);
      const business = await getBusiness(id),
        branches = business.branches || [];
      if (business.structureMode === "brand-only") throw fail("This workspace uses brands only. Add a brand instead.");
      await limit(business, "branch", branches.filter((item) => item.status !== "deleted").length);
      const name = text(req.body.name, 60);
      if (!name) throw fail("Branch name is required.");
      const departmentId = text(req.body.departmentId, 60);
      if (business.structureMode === "branch-only" && departmentId)
        throw fail("Branches in this workspace cannot be assigned to a department.");
      if (departmentId && !(business.departments || []).some((item) =>
        item.departmentId === departmentId && (item.status || "active") === "active"))
        throw fail("Choose an active department for this business.");
      const branch = {
        branchId: crypto.randomUUID(),
        departmentId,
        name,
        address: text(req.body.address, 140),
        status: "active",
      };
      checkDepartmentName(branches, branch);
      await updateBusiness(id, { branches: [...branches, branch] });
      await audit(req, "Branch created", id, name);
      res.status(201).json({ branch });
    }),
  );
  app.patch(
    "/api/portal/businesses/:businessId/branches/:branchId",
    auth,
    route(async (req, res) => {
      const id = scope(req);
      owner(req);
      const business = await getBusiness(id),
        branches = (business.branches || []).map((item) => ({
          branchId: item.branchId,
          departmentId: item.departmentId || "",
          name: item.name,
          address: item.address,
          status: item.status,
          deletedAt: item.deletedAt,
        }));
      const branch = branches.find(
        (item) => item.branchId === req.params.branchId,
      );
      if (!branch) throw fail("Branch not found.", 404);
      if (branch.status === "deleted") throw fail("Deleted branches cannot be edited.", 410);
      if (business.structureMode === "brand-only" && (req.body.name !== undefined || req.body.departmentId !== undefined))
        throw fail("Edit the brand instead of its internal redemption unit.");
      if (req.body.name !== undefined) {
        branch.name = text(req.body.name, 60);
        if (!branch.name) throw fail("Branch name is required.");
      }
      if (req.body.address !== undefined)
        branch.address = text(req.body.address, 140);
      if (req.body.departmentId !== undefined) {
        const departmentId = text(req.body.departmentId, 60);
        if (business.structureMode === "branch-only" && departmentId)
          throw fail("Branches in this workspace cannot be assigned to a department.");
        if (departmentId && !(business.departments || []).some((item) =>
          item.departmentId === departmentId && (item.status || "active") === "active"))
          throw fail("Choose an active department for this business.");
        branch.departmentId = departmentId;
      }
      if (req.body.status !== undefined) {
        if (!["active", "paused"].includes(req.body.status))
          throw fail("Invalid branch status.");
        branch.status = req.body.status;
      }
      checkDepartmentName(branches, branch);
      await updateBusiness(id, { branches });
      await audit(req, "Branch updated", id, branch.name);
      res.json({ branch });
    }),
  );
  app.delete(
    "/api/portal/businesses/:businessId/branches/:branchId",
    auth,
    route(async (req, res) => {
      const id = scope(req);
      owner(req);
      const business = await getBusiness(id), branches = business.branches || [];
      const branch = branches.find((item) => item.branchId === req.params.branchId);
      if (!branch) throw fail("Branch not found.", 404);
      if (business.structureMode === "brand-only") throw fail("Delete the brand instead of its internal redemption unit.");
      if (branch.status === "deleted") throw fail("Branch is already deleted.", 410);
      const deletedAt = new Date().toISOString();
      const archived = { ...branch, status: "deleted", deletedAt };
      await updateBusiness(id, { branches: branches.map((item) =>
        item.branchId === branch.branchId ? archived : item) });
      await audit(req, "Branch deleted", id, `${branch.name} (archived for super-admin visibility)`);
      res.json({ ok: true, archived: true, branch: archived });
    }),
  );
  app.post(
    "/api/portal/businesses/:businessId/branches/:branchId/restore",
    auth,
    superOnly,
    route(async (req, res) => {
      const id = scope(req);
      const business = await getBusiness(id), branches = business.branches || [];
      const branch = branches.find((item) => item.branchId === req.params.branchId);
      if (!branch) throw fail("Branch not found.", 404);
      if (branch.status !== "deleted") throw fail("Branch is not deleted.", 409);
      await limit(business, "branch", branches.filter((item) => item.status !== "deleted").length);
      if (branch.departmentId && !(business.departments || []).some((item) =>
        item.departmentId === branch.departmentId && (item.status || "active") === "active"))
        throw fail("Restore the branch's department first.", 409);
      const { deletedAt: _deletedAt, ...savedBranch } = branch;
      const restored = { ...savedBranch, status: "active" };
      checkDepartmentName(branches, restored);
      await updateBusiness(id, { branches: branches.map((item) =>
        item.branchId === branch.branchId ? restored : item) });
      await audit(req, "Branch restored", id, branch.name);
      res.json({ ok: true, restored: true, branch: restored });
    }),
  );
  app.delete(
    "/api/portal/businesses/:businessId/departments/:departmentId",
    auth,
    route(async (req, res) => {
      const id = scope(req);
      owner(req);
      const business = await getBusiness(id),
        departments = business.departments || [], branches = business.branches || [];
      const department = departments.find((item) => item.departmentId === req.params.departmentId);
      if (!department) throw fail("Department not found.", 404);
      if (department.status === "deleted") throw fail("Department is already deleted.", 410);
      const deletedAt = new Date().toISOString();
      const archivedDepartment = { ...department, status: "deleted", deletedAt };
      let archivedBranches = 0;
      const nextBranches = branches.map((item) => {
        if (item.departmentId !== department.departmentId || item.status === "deleted") return item;
        archivedBranches++;
        return { ...item, status: "deleted", deletedAt };
      });
      await updateBusiness(id, {
        departments: departments.map((item) => item.departmentId === department.departmentId ? archivedDepartment : item),
        branches: nextBranches,
      });
      await audit(req, "Department deleted", id,
        `${department.name} (${archivedBranches} branches archived for super-admin visibility)`);
      res.json({ ok: true, archived: true, department: archivedDepartment, archivedBranches });
    }),
  );
  app.post(
    "/api/portal/businesses/:businessId/departments/:departmentId/restore",
    auth,
    superOnly,
    route(async (req, res) => {
      const id = scope(req);
      const business = await getBusiness(id),
        departments = business.departments || [], branches = business.branches || [];
      const department = departments.find((item) => item.departmentId === req.params.departmentId);
      if (!department) throw fail("Department not found.", 404);
      if (department.status !== "deleted") throw fail("Department is not deleted.", 409);
      await limit(business, "department", departments.filter((item) => item.status !== "deleted").length);
      const deletionTime = department.deletedAt ? new Date(department.deletedAt).getTime() : null;
      const branchesToRestore = branches.filter((item) => item.departmentId === department.departmentId
        && item.status === "deleted" && deletionTime !== null
        && new Date(item.deletedAt).getTime() === deletionTime);
      const limits = await businessLimits(business);
      const activeBranchCount = branches.filter((item) => item.status !== "deleted").length;
      if (limits.branch > 0 && activeBranchCount + branchesToRestore.length > limits.branch)
        throw fail(`branch limit reached (${limits.branch}). Increase the limit or delete another branch before restoring this department.`, 403);
      const { deletedAt: _deletedAt, ...savedDepartment } = department;
      const restoredDepartment = { ...savedDepartment, status: "active" };
      const restoreIds = new Set(branchesToRestore.map((item) => item.branchId));
      const restoredBranches = branchesToRestore.map((item) => {
        const { deletedAt: _branchDeletedAt, ...savedBranch } = item;
        return { ...savedBranch, status: "active" };
      });
      const activeBranches = branches.filter((item) => item.status !== "deleted");
      for (const branch of restoredBranches) {
        checkDepartmentName(activeBranches, branch);
        activeBranches.push(branch);
      }
      const restoredById = new Map(restoredBranches.map((item) => [item.branchId, item]));
      await updateBusiness(id, {
        departments: departments.map((item) => item.departmentId === department.departmentId ? restoredDepartment : item),
        branches: branches.map((item) => restoreIds.has(item.branchId) ? restoredById.get(item.branchId) : item),
      });
      await audit(req, "Department restored", id,
        `${department.name} (${restoredBranches.length} branches restored)`);
      res.json({ ok: true, restored: true, department: restoredDepartment, branches: restoredBranches });
    }),
  );
  app.get(
    "/api/portal/users",
    auth,
    route(async (req, res) => {
      owner(req);
      const id = scope(req);
      const visibleBusinesses = new Set((await listBusinesses()).map((business) => business.businessId));
      res.json({
        users: (await users())
          .filter((item) => item.status !== "deleted" && visibleBusinesses.has(item.businessId) && (!id || item.businessId === id))
          .map(safe),
      });
    }),
  );
  app.post(
    "/api/portal/users",
    auth,
    route(async (req, res) => {
      owner(req);
      const id = scope(req),
        business = await getBusiness(id),
        items = await users();
      await limit(
        business,
        "account",
        1 + items.filter((item) => item.businessId === id && item.status !== "deleted").length,
      );
      const name = text(req.body.name, 60);
      if (!name) throw fail("Full name is required.");
      if (!["admin", "editor", "viewer", "branch-staff"].includes(req.body.role)) throw fail("Choose a valid role.");
      const branch = req.body.role === "branch-staff"
        ? business.branches?.find((item) => item.branchId === text(req.body.branchId, 60) && item.status === "active")
        : null;
      if (req.body.role === "branch-staff" && !branch)
        throw fail("Choose an active branch for this staff account.");
      const requestedLoginId = String(req.body.loginId || "").trim();
      if (req.body.role === "branch-staff" && !requestedLoginId)
        throw fail("Login ID is required for branch staff.");
      const generated = req.body.role === "branch-staff" || req.body.generateCredentials === true || !req.body.email;
      const suppliedPassword = generated ? accountPassword(req.body.password) : String(req.body.password || ""),
        credentials = generated ? {
          loginId: requestedLoginId ? await reserveLoginId(requestedLoginId, {
            reusableStaffBusinessId: req.body.role === "branch-staff" ? id : "",
          }) : await issueLoginId(),
          password: suppliedPassword,
        } : null;
      const email = text(req.body.email).toLowerCase(),
        password = credentials?.password || suppliedPassword;
      if (
        (!generated && !/^\S+@\S+\.\S+$/.test(email)) ||
        (!generated && password.length < 10) ||
        password.length > 200
      )
        throw fail(
          "Name, valid email, and a password of 10–200 characters are required.",
        );
      if (!generated && (
        items.some((item) => item.email === email) ||
        (await listBusinesses()).some((item) => item.loginEmail === email) ||
        email === primaryLogin()
      ))
        throw fail("Email already exists.", 409);
      const user = {
        id: crypto.randomUUID(),
        businessId: id,
        name,
        ...(generated ? { loginId: credentials.loginId } : { email }),
        passwordHash: hashPassword(password),
        role: req.body.role,
        ...(branch ? { branchId: branch.branchId } : {}),
        status: "active",
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
        loginCount: 0,
      };
      await changeMeta("users", (records) => {
        if (generated && (records || []).some(item => item.status !== "deleted"
          && String(item.loginId || item.email || "").toLowerCase() === user.loginId.toLowerCase()))
          throw fail("This login ID already exists.", 409);
        if (!generated && (records || []).some((item) => item.email === email))
          throw fail("Email already exists.", 409);
        return [...(records || []), user];
      });
      await audit(req, "Team account created", id, user.loginId || email);
      res.set("Cache-Control", "no-store").status(201).json({ user: safe(user), ...(credentials ? { credentials } : {}) });
    }),
  );
  app.patch(
    "/api/portal/users/:userId",
    auth,
    route(async (req, res) => {
      owner(req);
      const id = scope(req),
        account = (await users()).find((item) => item.id === req.params.userId);
      if (!account || account.status === "deleted" || (id && account.businessId !== id))
        throw fail("Account not found.", 404);
      if (account.id === req.user.id)
        throw fail("Use your account settings to update your own account.");
      const patch = {};
      if (req.body.role !== undefined) {
        if (!["admin", "editor", "viewer", "branch-staff"].includes(req.body.role))
          throw fail("Invalid role.");
        patch.role = req.body.role;
      }
      if (req.body.branchId !== undefined || req.body.role === "branch-staff") {
        const business = await getBusiness(account.businessId);
        const branchId = text(req.body.branchId ?? account.branchId, 60);
        const branch = business.branches?.find((item) => item.branchId === branchId && item.status === "active");
        if (!branch) throw fail("Choose an active branch for this staff account.");
        patch.branchId = branch.branchId;
      } else if (req.body.role && req.body.role !== "branch-staff") {
        patch.branchId = "";
      }
      if (req.body.status !== undefined) {
        if (!["active", "paused"].includes(req.body.status))
          throw fail("Invalid status.");
        patch.status = req.body.status;
      }
      if (req.body.password) {
        if (typeof req.body.password !== "string" || req.body.password.length < 10 || req.body.password.length > 200)
          throw fail("Use a password of 10–200 characters.");
        patch.passwordHash = hashPassword(req.body.password);
      }
      await changeMeta("users", (records) => {
        if (!records.some((item) => item.id === account.id && item.status !== "deleted"))
          throw fail("Account not found.", 404);
        return records.map((item) =>
          item.id === account.id ? { ...item, ...patch } : item,
        );
      });
      await changeMeta("versions", (values) => ({
        ...values,
        [account.id]: (values?.[account.id] || 0) + 1,
      }));
      await audit(
        req,
        "Team account updated",
        account.businessId,
        account.loginId || account.email,
      );
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/portal/users/:userId",
    auth,
    route(async (req, res) => {
      owner(req);
      const id = scope(req);
      let removed;
      await changeMeta("users", (records = []) => {
        const account = records.find((item) => item.id === req.params.userId);
        if (!account || account.status === "deleted" || account.role !== "branch-staff"
          || (id && account.businessId !== id)) throw fail("Staff account not found.", 404);
        if (account.id === req.user.id) throw fail("You cannot delete your own account.", 403);
        if (req.body?.confirmName !== account.name)
          throw fail("Confirm the staff member's name before deleting this account.");
        removed = account;
        // Archive identity for historical/legacy redemption records. Deleted
        // accounts are excluded from management lists, logins and allowances.
        return records.map((item) => item.id === account.id
          ? { ...item, status: "deleted", deletedAt: new Date().toISOString(), deletedBy: req.user.id }
          : item);
      });
      await changeMeta("versions", (values) => ({
        ...values, [removed.id]: (values?.[removed.id] || 0) + 1,
      }));
      await audit(req, "Staff account deleted", removed.businessId,
        `${removed.name} · ${removed.loginId || removed.email} (archived; redemption history retained)`);
      res.json({ ok: true, deleted: true, archived: true });
    }),
  );
  app.get(
    "/api/portal/settings",
    auth,
    superOnly,
    route(async (_req, res) => res.json({ settings: await settings() })),
  );
  app.put(
    "/api/portal/settings",
    auth,
    superOnly,
    route(async (req, res) => {
      const previous = await settings();
      const config = {
        platformName: text(req.body.platformName, 40),
        supportEmail: text(req.body.supportEmail),
        supportUrl: text(req.body.supportUrl ?? previous.supportUrl, 500),
        loginMessage: text(req.body.loginMessage ?? previous.loginMessage, 200),
        defaultLimits: validateLimits(req.body.defaultLimits ?? previous.defaultLimits),
        memberAccess: req.body.memberAccess !== false,
        cardCreation: req.body.cardCreation !== false,
        sessionHours: Number(req.body.sessionHours),
      };
      if (config.supportEmail && !/^\S+@\S+\.\S+$/.test(config.supportEmail))
        throw fail("Enter a valid support email.");
      if (config.supportUrl) {
        let url;
        try { url = new URL(config.supportUrl); } catch { throw fail("Enter a valid support website URL."); }
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
          throw fail("Support website must use http or https, without credentials.");
        config.supportUrl = url.href;
      }
      if (
        !config.platformName ||
        !Number.isInteger(config.sessionHours) ||
        config.sessionHours < 1 ||
        config.sessionHours > 48
      )
        throw fail("Enter a platform name and session duration of 1–48 hours.");
      await changeMeta("settings", () => config);
      await audit(req, "Platform settings updated");
      res.json({ settings: config });
    }),
  );
  app.get(
    "/api/portal/audit",
    auth,
    route(async (req, res) => {
      owner(req);
      const id = scope(req);
      res.json({
        events: ((await readMeta(["audit"])).audit || []).filter(
          (item) => !id || item.businessId === id,
        ),
      });
    }),
  );
  app.post(
    "/api/portal/security/revoke",
    auth,
    route(async (req, res) => {
      owner(req);
      const id = scope(req),
        all = await users(),
        business = id ? await getBusiness(id) : null;
      const ids = [
        ...(!id ? ["super-admin", ...((await readMeta(["superAdmins"])).superAdmins || []).map((item) => item.id)] : []),
        ...all
          .filter((item) => !id || item.businessId === id)
          .map((item) => item.id),
        ...(business
          ? [business.businessId]
          : (await listBusinesses()).map((item) => item.businessId)),
      ].filter((value) => value !== req.user.id);
      await changeMeta("versions", (values) => {
        const result = { ...values };
        for (const key of ids) result[key] = (result[key] || 0) + 1;
        return result;
      });
      await audit(req, "Other sessions revoked", id);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/portal/security/password",
    auth,
    route(async (req, res) => {
      const { currentPassword, password } = req.body;
      if (
        typeof password !== "string" ||
        password.length < 10 ||
        password.length > 200
      )
        throw fail("Use a new password of 10–200 characters.");
      if (req.user.role === "super-admin" && req.user.id !== "super-admin") {
        await changeMeta("superAdmins", (records = []) => {
          const account = records.find((item) => item.id === req.user.id);
          if (!account || !verifyPassword(currentPassword, account.passwordHash)) throw fail("Current password is incorrect.");
          return records.map((item) => item.id === account.id ? { ...item, passwordHash: hashPassword(password) } : item);
        });
      } else if (req.user.role === "super-admin") {
        const meta = await readMeta(["adminPasswordHash"]);
        const valid = meta.adminPasswordHash
          ? verifyPassword(currentPassword, meta.adminPasswordHash)
          : equal(
              String(currentPassword || ""),
              process.env.SUPER_ADMIN_PASSWORD ||
                process.env.SUPER_ADMIN_KEY ||
                "",
            );
        if (!valid) throw fail("Current password is incorrect.");
        await changeMeta("adminPasswordHash", () => hashPassword(password));
      } else if (req.user.role === "business") {
        const business = await getBusiness(req.user.businessId);
        if (!verifyPassword(currentPassword, business.passwordHash))
          throw fail("Current password is incorrect.");
        await updateBusiness(business.businessId, {
          passwordHash: hashPassword(password),
          passwordVersion: crypto.randomUUID(),
        });
      } else {
        const account = (await users()).find((item) => item.id === req.user.id);
        if (!verifyPassword(currentPassword, account?.passwordHash))
          throw fail("Current password is incorrect.");
        await changeMeta("users", (records) =>
          records.map((item) =>
            item.id === account.id
              ? { ...item, passwordHash: hashPassword(password) }
              : item,
          ),
        );
      }
      await changeMeta("versions", (values) => ({
        ...values,
        [req.user.id]: (values?.[req.user.id] || 0) + 1,
      }));
      await audit(req, "Password changed", req.user.businessId);
      const version = (await readMeta(["versions"])).versions?.[req.user.id] || 0;
      const user = { ...req.user, version };
      res.json({ ok: true, token: await sign(user), user });
    }),
  );
  app.patch(
    "/api/portal/cards/:slug",
    auth,
    route(async (req, res) => {
      if (["viewer", "branch-staff"].includes(req.user.role))
        throw fail("This account cannot change cards.", 403);
      const card = (await cardRows(req)).find(
        (item) => item.slug === req.params.slug,
      );
      if (!card) throw fail("Card not found.", 404);
      if (card.deletedAt) throw fail("Restore this coupon before changing it.", 409);
      const patch = { disabled: Boolean(req.body.disabled) };
      if (card.scratchedAt || card.staffRedeemedAt || card.redeemedAt)
        throw fail("Scratched or redeemed cards cannot be changed.");
      if (isMongo()) {
        const result = await Card.updateOne(
          { slug: card.slug, redeemedAt: null, scratchedAt: null, staffRedeemedAt: null },
          { $set: patch },
        );
        if (!result.matchedCount)
          throw fail("This card has already been redeemed.", 409);
      } else
        await mutateLocalCards((items) => {
          const current = items.find((item) => item.slug === card.slug);
          if (current.scratchedAt || current.staffRedeemedAt || current.redeemedAt)
            throw fail("This card has already been scratched or redeemed.", 409);
          Object.assign(current, patch);
        });
      await audit(
        req,
        patch.disabled ? "Card disabled" : "Card enabled",
        card.businessId,
        card.couponCode,
      );
      res.json({ ok: true });
    }),
  );
  async function validateCreate(req, checkLimit = true) {
    if (["viewer", "branch-staff"].includes(req.user.role))
      throw fail("This account cannot create scratch cards.", 403);
    if (!(await settings()).cardCreation)
      throw fail("Card creation is paused by the administrator.", 403);
    const id = scope(req),
      business = await getBusiness(id);
    if (business.status !== "active")
      throw fail("This business is paused.", 403);
    if (checkLimit) await limit(business, "card", (await cardRows(req)).length);
    if (
      req.body.branchId &&
      !(business.branches || []).some(
        (item) =>
          item.branchId === req.body.branchId && item.status === "active",
      )
    )
      throw fail("Choose an active branch for this business.");
    return business;
  }
  return {
    authenticate: auth,
    superOnly,
    scope,
    audit,
    validateCreate,
    getBusiness,
    businessLimits,
    cardRows,
    resolveRedemptionRecord,
  };
}
