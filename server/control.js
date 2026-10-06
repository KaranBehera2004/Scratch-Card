import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

const text = (value, max = 120) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const safe = (value) => {
  const { passwordHash, ...result } = value;
  return result;
};
const equal = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const defaults = {
  platformName: "Lucky Drop",
  supportEmail: "",
  supportUrl: "",
  loginMessage: "Sign in to manage your scratch-card workspace.",
  defaultLimits: { card: 100, branch: 2, account: 1 },
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
    userLimit: 3,
    monthlyPrice: 0,
  },
  {
    id: "growth",
    name: "Growth",
    cardLimit: 1000,
    branchLimit: 10,
    userLimit: 20,
    monthlyPrice: 999,
  },
  {
    id: "unlimited",
    name: "Unlimited",
    cardLimit: 0,
    branchLimit: 0,
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
  } = context;
  let queue = Promise.resolve();
  const filename = path.join(dataDir, "control.json");
  async function readMeta() {
    if (isMongo())
      return Object.fromEntries(
        (await Meta.find().lean()).map((item) => [item.key, item.value]),
      );
    try {
      return JSON.parse(await fs.readFile(filename, "utf8"));
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
      await fs.rename(`${filename}.tmp`, filename);
      return value;
    });
    queue = run.catch(() => {});
    return run;
  }
  const settings = async () => ({
    ...defaults,
    ...(await readMeta()).settings,
  });
  // Read old assignments only to preserve existing businesses' allowances.
  const legacyPlans = async () => (await readMeta()).plans || basePlans;
  async function businessLimits(business, legacy = null) {
    const plan = (legacy || (await legacyPlans())).find(
      (item) => item.id === business.planId,
    );
    const previousUsers = business.limits?.user ?? plan?.userLimit ?? 0;
    return {
      card: business.limits?.card ?? plan?.cardLimit ?? 0,
      branch: business.limits?.branch ?? plan?.branchLimit ?? 0,
      account:
        business.limits?.account ?? (previousUsers > 0 ? previousUsers + 1 : 0),
    };
  }
  function validateLimits(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw fail("Enter the business's card, branch and account limits.");
    const limits = {};
    for (const key of ["card", "branch", "account"]) {
      const input = value[key];
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
  const users = async () => (await readMeta()).users || [];
  const primaryLogin = () => String(process.env.SUPER_ADMIN_LOGIN_ID || process.env.SUPER_ADMIN_EMAIL || "admin@luckydrop.local").trim().toLowerCase();
  // Reserve IDs atomically across server instances. Only password hashes are
  // stored; plaintext credentials are returned once to the creating admin.
  async function issueCredentials(prefix) {
    let loginId;
    await changeMeta("loginIds", (ids = []) => {
      do { loginId = `${prefix}-${crypto.randomBytes(10).toString("hex")}`; }
      while (ids.includes(loginId));
      return [...ids, loginId];
    });
    return { loginId, password: `A9!a${crypto.randomBytes(18).toString("base64url")}` };
  }
  const secret = () =>
    process.env.AUTH_SECRET ||
    process.env.SUPER_ADMIN_PASSWORD ||
    process.env.SUPER_ADMIN_KEY;
  const sign = async (user) => {
    if (!secret()) throw fail("Configure AUTH_SECRET before signing in.", 503);
    const body = Buffer.from(
      JSON.stringify({
        ...user,
        exp: Date.now() + (await settings()).sessionHours * 3600000,
      }),
    ).toString("base64url");
    return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`;
  };
  async function audit(req, action, businessId = "", detail = "") {
    await changeMeta("audit", (records) =>
      [
        {
          id: crypto.randomUUID(),
          actor: req.user?.loginId || req.user?.email || "System",
          action,
          businessId,
          detail,
          createdAt: new Date().toISOString(),
        },
        ...(records || []),
      ].slice(0, 2000),
    );
  }
  async function getBusiness(id) {
    const business = (await listBusinesses()).find(
      (item) => item.businessId === id,
    );
    if (!business) throw fail("Business not found.", 404);
    return business;
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
    const meta = await readMeta();
    if ((user.version || 0) !== (meta.versions?.[user.id] || 0))
      throw fail("This session was revoked. Please sign in again.", 401);
    if (
      !["super-admin", "business", "admin", "editor", "viewer"].includes(
        user.role,
      )
    )
      throw fail("Invalid account role.", 401);
    if (user.role === "super-admin" && user.id !== "super-admin") {
      const account = (meta.superAdmins || []).find((item) => item.id === user.id && item.status === "active");
      if (!account) throw fail("Account access is suspended.", 403);
      user.name = account.name;
    } else if (user.role !== "super-admin") {
      const business = (await listBusinesses()).find((item) => item.businessId === user.businessId);
      if (!business) throw fail("This business is no longer available. Please sign in again.", 401);
      if (business.status !== "active" || !(await settings()).memberAccess)
        throw fail("Business access is paused.", 403);
      if (user.role !== "business") {
        const account = (meta.users || []).find(
          (item) => item.id === user.id && item.status === "active",
        );
        if (!account) throw fail("Account access is suspended.", 403);
        user.role = account.role;
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
    const visibleBusinesses = new Set((await listBusinesses()).map((business) => business.businessId));
    const id = scope(req),
      query =
        id === "impact-vibes"
          ? { $or: [{ businessId: id }, { businessId: { $exists: false } }] }
          : id
            ? { businessId: id }
            : {};
    const cards = isMongo()
      ? await Card.find(query).sort({ createdAt: -1 }).lean()
      : await readLocalCards();
    return cards
      .filter((item) => visibleBusinesses.has(item.businessId || "impact-vibes"))
      .filter((item) => !id || (item.businessId || "impact-vibes") === id)
      .map((item) => ({
        ...item,
        businessId: item.businessId || "impact-vibes",
        used: Boolean(item.redeemedAt),
        status: item.redeemedAt
          ? "redeemed"
          : item.disabled
            ? "disabled"
            : item.expiresAt && new Date(item.expiresAt) < new Date()
              ? "expired"
              : "available",
      }))
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
  const attempts = new Map();
  app.post(
    "/api/auth/login",
    route(async (req, res) => {
      const bucket = attempts.get(req.ip) || {
        count: 0,
        until: Date.now() + 60000,
      };
      if (bucket.until < Date.now()) {
        bucket.count = 0;
        bucket.until = Date.now() + 60000;
      }
      if (++bucket.count > 12)
        throw fail("Too many sign-in attempts. Try again in one minute.", 429);
      attempts.set(req.ip, bucket);
      const email = text(req.body.loginId ?? req.body.email).toLowerCase(),
        password = String(req.body.password || "");
      if (!password || password.length > 200)
        throw fail("Invalid login ID or password.", 401);
      const meta = await readMeta(),
        adminEmail = primaryLogin();
      let user;
      if (
        email === adminEmail &&
        !meta.adminPasswordHash &&
        secret() &&
        equal(
          password,
          String(
            process.env.SUPER_ADMIN_PASSWORD ||
              process.env.SUPER_ADMIN_KEY ||
              "",
          ),
        )
      )
        user = {
          id: "super-admin",
          role: "super-admin",
          name: "Super admin",
          email,
        };
      if (
        email === adminEmail &&
        meta.adminPasswordHash &&
        verifyPassword(password, meta.adminPasswordHash)
      )
        user = {
          id: "super-admin",
          role: "super-admin",
          name: "Super admin",
          email,
        };
      if (!user) {
        const account = (meta.superAdmins || []).find((item) => item.loginId === email && item.status === "active");
        if (account && verifyPassword(password, account.passwordHash)) user = safe(account);
      }
      if (!user) {
        const business = (await listBusinesses()).find(
          (item) => (item.loginId || item.loginEmail) === email,
        );
        if (business && verifyPassword(password, business.passwordHash))
          user = {
            id: business.businessId,
            role: "business",
            businessId: business.businessId,
            name: business.name,
            email,
            ...(business.loginId ? { loginId: business.loginId } : {}),
          };
        else {
          const account = (meta.users || []).find(
            (item) => (item.loginId || item.email) === email && item.status === "active",
          );
          if (account && verifyPassword(password, account.passwordHash))
            user = safe(account);
        }
        if (!user) throw fail("Invalid login ID or password.", 401);
        if (
          (await getBusiness(user.businessId)).status !== "active" ||
          !(await settings()).memberAccess
        )
          throw fail("Business access is paused.", 403);
      }
      user.version = meta.versions?.[user.id] || 0;
      attempts.delete(req.ip);
      req.user = user;
      await audit(req, "Signed in", user.businessId);
      res.set("Cache-Control", "no-store").json({ token: await sign(user), user });
    }),
  );
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
        ...((await readMeta()).superAdmins || []).map(safe),
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
      const credentials = await issueCredentials("sa");
      const user = { id: crypto.randomUUID(), name, loginId: credentials.loginId,
        passwordHash: hashPassword(credentials.password), role: "super-admin",
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
          items.map(async (item) => ({
            ...safe(item),
            limits: await businessLimits(item, legacy),
          })),
        ),
      });
    }),
  );
  app.post(
    "/api/portal/businesses",
    auth,
    superOnly,
    route(async (req, res) => {
      const name = text(req.body.name, 60),
        generated = req.body.generateCredentials === true || (!req.body.loginEmail && !req.body.password);
      if (!name) throw fail("Business name is required.");
      const limits = validateLimits(req.body.limits);
      const credentials = generated ? await issueCredentials("biz") : null;
      const email = text(req.body.loginEmail).toLowerCase(),
        password = credentials?.password || String(req.body.password || "");
      if (
        (!generated && !/^\S+@\S+\.\S+$/.test(email)) ||
        password.length < 10 ||
        password.length > 200
      )
        throw fail(
          "Business name, valid email and a password of at least 10 characters are required.",
        );
      if (!generated && (
        (await listBusinesses()).some((item) => item.loginEmail === email) ||
        (await users()).some((item) => item.email === email) ||
        email === primaryLogin()
      ))
        throw fail("This login email already exists.", 409);
      const business = {
        businessId: `biz_${crypto.randomBytes(6).toString("hex")}`,
        name,
        ...(generated ? { loginId: credentials.loginId } : { loginEmail: email }),
        passwordHash: hashPassword(password),
        website: safeUrl(req.body.website),
        status: "active",
        branches: [],
        limits,
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
      if (req.body.limits !== undefined && req.user.role !== "super-admin")
        throw fail(
          "Only the super administrator can change business limits.",
          403,
        );
      if (req.body.planId !== undefined && req.body.planId !== business.planId)
        throw fail(
          "Set limits directly on the business instead of assigning a plan.",
        );
      if (req.user.role === "super-admin") {
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
        if (req.body.name !== undefined) {
          patch.name = text(req.body.name, 60);
          if (!patch.name) throw fail("Business name is required.");
        }
        if (req.body.status !== undefined) {
          if (!["active", "paused"].includes(req.body.status))
            throw fail("Invalid status.");
          patch.status = req.body.status;
        }
        if (req.body.limits !== undefined)
          patch.limits = validateLimits(req.body.limits);
        if (req.body.password) {
          if (req.body.password.length < 10 || req.body.password.length > 200)
            throw fail("Use a password of 10–200 characters.");
          patch.passwordHash = hashPassword(req.body.password);
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
        "Business settings updated",
        id,
        Object.keys(patch)
          .filter((key) => key !== "passwordHash")
          .join(", "),
      );
      res.json({ ok: true });
    }),
  );
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
    "/api/portal/businesses/:businessId/branches",
    auth,
    route(async (req, res) => {
      const id = scope(req);
      owner(req);
      const business = await getBusiness(id),
        branches = business.branches || [];
      await limit(business, "branch", branches.length);
      const name = text(req.body.name, 60);
      if (!name) throw fail("Branch name is required.");
      const branch = {
        branchId: crypto.randomUUID(),
        name,
        address: text(req.body.address, 140),
        status: "active",
      };
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
          name: item.name,
          address: item.address,
          status: item.status,
        }));
      const branch = branches.find(
        (item) => item.branchId === req.params.branchId,
      );
      if (!branch) throw fail("Branch not found.", 404);
      if (req.body.name !== undefined) {
        branch.name = text(req.body.name, 60);
        if (!branch.name) throw fail("Branch name is required.");
      }
      if (req.body.address !== undefined)
        branch.address = text(req.body.address, 140);
      if (req.body.status !== undefined) {
        if (!["active", "paused"].includes(req.body.status))
          throw fail("Invalid branch status.");
        branch.status = req.body.status;
      }
      await updateBusiness(id, { branches });
      await audit(req, "Branch updated", id, branch.name);
      res.json({ branch });
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
          .filter((item) => visibleBusinesses.has(item.businessId) && (!id || item.businessId === id))
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
        1 + items.filter((item) => item.businessId === id).length,
      );
      const name = text(req.body.name, 60);
      if (!name) throw fail("Full name is required.");
      if (!["admin", "editor", "viewer"].includes(req.body.role)) throw fail("Choose a valid role.");
      const generated = req.body.generateCredentials === true || (!req.body.email && !req.body.password);
      const credentials = generated ? await issueCredentials("user") : null;
      const email = text(req.body.email).toLowerCase(),
        password = credentials?.password || String(req.body.password || "");
      if (
        (!generated && !/^\S+@\S+\.\S+$/.test(email)) ||
        password.length < 10 ||
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
        status: "active",
      };
      await changeMeta("users", (records) => {
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
      if (!account || (id && account.businessId !== id))
        throw fail("Account not found.", 404);
      if (account.id === req.user.id)
        throw fail("Use your account settings to update your own account.");
      const patch = {};
      if (req.body.role !== undefined) {
        if (!["admin", "editor", "viewer"].includes(req.body.role))
          throw fail("Invalid role.");
        patch.role = req.body.role;
      }
      if (req.body.status !== undefined) {
        if (!["active", "paused"].includes(req.body.status))
          throw fail("Invalid status.");
        patch.status = req.body.status;
      }
      if (req.body.password) {
        if (req.body.password.length < 10 || req.body.password.length > 200)
          throw fail("Use a password of 10–200 characters.");
        patch.passwordHash = hashPassword(req.body.password);
      }
      await changeMeta("users", (records) =>
        records.map((item) =>
          item.id === account.id ? { ...item, ...patch } : item,
        ),
      );
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
        events: ((await readMeta()).audit || []).filter(
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
        ...(!id ? ["super-admin", ...((await readMeta()).superAdmins || []).map((item) => item.id)] : []),
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
        const meta = await readMeta();
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
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/portal/cards/:slug",
    auth,
    route(async (req, res) => {
      if (req.user.role === "viewer")
        throw fail("Viewer accounts cannot change cards.", 403);
      const card = (await cardRows(req)).find(
        (item) => item.slug === req.params.slug,
      );
      if (!card) throw fail("Card not found.", 404);
      const patch = { disabled: Boolean(req.body.disabled) };
      if (card.redeemedAt) throw fail("Redeemed cards cannot be changed.");
      if (isMongo()) {
        const result = await Card.updateOne(
          { slug: card.slug, redeemedAt: null },
          { $set: patch },
        );
        if (!result.matchedCount)
          throw fail("This card has already been redeemed.", 409);
      } else
        await mutateLocalCards((items) => {
          const current = items.find((item) => item.slug === card.slug);
          if (current.redeemedAt)
            throw fail("This card has already been redeemed.", 409);
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
  async function validateCreate(req) {
    if (req.user.role === "viewer")
      throw fail("Viewer accounts cannot create scratch cards.", 403);
    if (!(await settings()).cardCreation)
      throw fail("Card creation is paused by the administrator.", 403);
    const id = scope(req),
      business = await getBusiness(id);
    if (business.status !== "active")
      throw fail("This business is paused.", 403);
    await limit(business, "card", (await cardRows(req)).length);
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
  };
}
