import crypto from "node:crypto";
import { normalizeWhatsAppNumber } from "../shared/whatsapp.js";

export const MAX_BATCH_SIZE = 1000;
export function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
export function validateBranchQuantities(rows, business) {
  if (!Array.isArray(rows) || !rows.length) throw bad("Add at least one branch.");
  const seen = new Set();
  let total = 0;
  const branches = rows.map((row) => {
    const branch = business.branches?.find((item) => item.branchId === row?.branchId && item.status === "active");
    if (!branch) throw bad("Choose an active branch for every row.");
    if (seen.has(branch.branchId)) throw bad("Each branch can be selected only once.");
    seen.add(branch.branchId);
    if (typeof row.quantity !== "number" || !Number.isSafeInteger(row.quantity) || row.quantity < 1)
      throw bad("Coupon quantities must be positive whole numbers.");
    total += row.quantity;
    if (total > MAX_BATCH_SIZE) throw bad(`Generate at most ${MAX_BATCH_SIZE} coupons per batch.`);
    return { branchId: branch.branchId, branchName: branch.name, quantity: row.quantity };
  });
  return { branches, total };
}
export function validateRecipients(rows, branches, total) {
  // Omitting the import preserves number-free and shared-number bulk creation.
  if (rows === undefined) return null;
  if (!Array.isArray(rows) || rows.length !== total || rows.length > MAX_BATCH_SIZE)
    throw bad(`Import exactly ${total} WhatsApp numbers, one for each coupon.`);
  const remaining = new Map(branches.map((branch) => [branch.branchId, branch.quantity]));
  const seen = new Set();
  const recipients = rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || !remaining.has(row.branchId))
      throw bad(`Imported row ${index + 1}: choose a branch from this batch.`);
    let customerPhone;
    try { customerPhone = normalizeWhatsAppNumber(row.customerPhone); }
    catch (error) { throw bad(`Imported row ${index + 1}: ${error.message}`); }
    if (seen.has(customerPhone)) throw bad(`Imported row ${index + 1}: this WhatsApp number is duplicated.`);
    seen.add(customerPhone);
    remaining.set(row.branchId, remaining.get(row.branchId) - 1);
    return { branchId: row.branchId, customerPhone };
  });
  if ([...remaining.values()].some((count) => count !== 0))
    throw bad("The imported number count for each branch must match its coupon quantity.");
  return recipients;
}
export function couponStatus(card) {
  return card.redeemedAt ? "redeemed" : card.disabled ? "disabled"
    : card.expiresAt && new Date(card.expiresAt) <= new Date() ? "expired"
      : card.scratchedAt ? "scratched" : "available";
}
export function batchFingerprint(base, branches, recipients = null) {
  // Ignore random generated identifiers and normalize row order for retry comparison.
  const { senderName, ...details } = base;
  return crypto.createHash("sha256").update(JSON.stringify({
    ...details, branches: branches.map(({ branchId, quantity }) => ({ branchId, quantity }))
      .sort((a, b) => a.branchId.localeCompare(b.branchId)),
    // Retain recipient order within each branch so retrying cannot reassign a
    // coupon to a different person. Branch row reordering remains harmless.
    ...(recipients ? { recipients: branches.map(({ branchId }) => ({ branchId,
      numbers: recipients.filter((row) => row.branchId === branchId).map((row) => row.customerPhone),
    })).sort((a, b) => a.branchId.localeCompare(b.branchId)) } : {}),
  })).digest("hex");
}
export function checkCapacity(cards, businessId, total, maximum) {
  const count = cards.filter((card) => (card.businessId || "impact-vibes") === businessId).length;
  if (maximum > 0 && count + total > maximum)
    throw bad(`This business has ${Math.max(0, maximum - count)} cards remaining. Requested ${total}.`, 403);
}

// The adapter commits metadata and coupons together: MongoDB transaction or one
// atomic local JSON replacement. There is never a partially committed batch.
export function installBulkRoutes(app, context) {
  const { authenticate, validateCreate, businessLimits, buildCard, saveGeneration, findBatch, audit, scope, getBusiness } = context;
  app.get("/api/portal/batches/:id", authenticate, async (req, res, next) => {
    try {
      const selected = req.query.businessId;
      if (selected !== undefined && (typeof selected !== "string" || !selected.trim() || selected.length > 60))
        throw bad("Choose a valid business to recover this batch.");
      // Adapt the explicit recovery selector to the existing permission helper;
      // its usual query.business selector must not conflict with businessId.
      const businessId = scope({ user: req.user, params: { ...req.params, businessId: selected },
        query: req.query, body: req.body });
      if (!businessId) throw bad("Choose a business to recover this batch.");
      const business = await getBusiness(businessId);
      const prefix = `${business.businessId}:`;
      const id = req.params.id;
      if (!id.startsWith(prefix) || !/^[A-Za-z0-9_-]{16,100}$/.test(id.slice(prefix.length)))
        throw bad("Batch not found.", 404);
      // Never load a foreign batch (which contains private recipient numbers).
      const batch = await findBatch(id);
      if (!batch) throw bad("Batch not found.", 404);
      res.set("Cache-Control", "private, no-store");
      res.json({ ...batch, recovered: true });
    } catch (error) { next(error); }
  });
  app.post("/api/cards/bulk", authenticate, async (req, res, next) => {
    try {
      if (req.user.role === "viewer") throw bad("Viewer accounts cannot create scratch cards.", 403);
      const business = await getBusiness(scope(req));
      const key = req.body.idempotencyKey;
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(key))
        throw bad("A valid batch retry key is required.");
      const batchKey = `${business.businessId}:${key}`;
      const previous = await findBatch(batchKey);
      const retryBusiness = previous ? { branches: previous.coupons.map((card) => ({ branchId: card.branchId, name: card.branchName, status: "active" })) } : business;
      const { branches, total } = validateBranchQuantities(req.body.branches, retryBusiness);
      const recipients = validateRecipients(req.body.recipients, branches, total);
      let base;
      try { base = buildCard(recipients ? { ...req.body, customerPhone: "" } : req.body, business, true, Boolean(previous)); }
      catch (error) { throw bad(error.message); }
      delete base.slug;
      const fingerprint = batchFingerprint(base, branches, recipients);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw bad("This retry key belongs to different batch details.", 409);
        return res.json({ ...previous, replayed: true });
      }
      await validateCreate(req, false);
      const maximum = (await businessLimits(business)).card;
      const result = await saveGeneration({ base, branches, total, maximum, batchKey, fingerprint, recipients });
      // An audit failure must not disguise an already committed batch as a failed generation.
      await audit(req, "Bulk coupons generated", business.businessId, `${result.savedCount} coupons · ${result.batchId}`).catch(console.error);
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      // No per-card partial commits. A network loss after commit is recovered by
      // resubmitting the same retry key, which returns the saved batch.
      next(error);
    }
  });
}
