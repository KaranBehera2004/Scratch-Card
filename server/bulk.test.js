import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateBranchQuantities, validateRecipients, batchFingerprint, MAX_BATCH_SIZE } from "./bulk.js";

test("branch quantity validation rejects duplicates, fractions, strings and oversized batches", () => {
  const business = { branches: [{ branchId: "a", name: "A", status: "active" }, { branchId: "b", status: "paused" }] };
  for (const quantity of [0, -1, 1.5, "25", NaN, Infinity, MAX_BATCH_SIZE + 1])
    assert.throws(() => validateBranchQuantities([{ branchId: "a", quantity }], business));
  for (const rows of [[], [{ branchId: "a", quantity: 1 }, { branchId: "a", quantity: 1 }], [{ branchId: "b", quantity: 1 }]])
    assert.throws(() => validateBranchQuantities(rows, business));
  assert.equal(validateBranchQuantities([{ branchId: "a", quantity: 25 }], business).total, 25);
});

test("recipient imports require unique valid numbers and exact branch counts", () => {
  const branches = [{ branchId: "a", quantity: 2 }, { branchId: "b", quantity: 1 }];
  const rows = [{ branchId: "a", customerPhone: "9876543210" },
    { branchId: "a", customerPhone: "+91 98765 43211" }, { branchId: "b", customerPhone: "9876543212" }];
  const normalized = validateRecipients(rows, branches, 3);
  assert.deepEqual(normalized.map((row) => row.customerPhone), ["+919876543210", "+919876543211", "+919876543212"]);
  assert.equal(validateRecipients(undefined, branches, 3), null);
  for (const invalid of [null, {}, [], rows.slice(1), [...rows, rows[0]],
    rows.map((row) => ({ ...row, branchId: "a" })),
    [rows[0], { ...rows[1], customerPhone: "+919876543210" }, rows[2]],
    [rows[0], { ...rows[1], customerPhone: "invalid" }, rows[2]],
    [rows[0], { ...rows[1], branchId: "other" }, rows[2]]])
    assert.throws(() => validateRecipients(invalid, branches, 3));
  const base = { businessId: "test", headline: "Surprise", customerPhone: "" };
  assert.equal(batchFingerprint(base, branches, normalized), batchFingerprint(base, [...branches].reverse(), normalized));
  assert.notEqual(batchFingerprint(base, branches, normalized), batchFingerprint(base, branches, [normalized[1], normalized[0], normalized[2]]));
});

test("persistent branch batches are atomic, unique, retry-safe, scoped and automatically redeemed on scratch", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "scratch-bulk-test-"));
  Object.assign(process.env, { DOTENV_CONFIG_PATH: path.join(temporary, "missing-env"), SCRATCH_DATA_ROOT: temporary,
    MONGODB_URI: "", AUTH_SECRET: "isolated-bulk-test-secret", SUPER_ADMIN_LOGIN_ID: "bulk-root",
    SUPER_ADMIN_PASSWORD: "Bulk-Root-Password", IMPACT_VIBES_EMAIL: "bulk-owner@example.test", IMPACT_VIBES_PASSWORD: "Bulk-Owner-Password" });
  for (const key of ["VERCEL", "NETLIFY", "AWS_LAMBDA_FUNCTION_NAME"]) delete process.env[key];
  // Migration preserves completed redemptions and consumes old scratched cards.
  const dataDir = path.join(temporary, "server/data");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, "cards.json"), JSON.stringify([
    { slug: "legacy01", couponCode: "LEGACY-CODE", redeemedAt: "2025-01-01T00:00:00.000Z" },
    { slug: "legacy02", couponCode: "OLD-SCRATCHED", scratchedAt: "2025-02-01T00:00:00.000Z", branchId: "historical-branch", disabled: true },
    { slug: "legacy03", couponCode: "OLD-REDEEMED", scratchedAt: "2025-02-02T00:00:00.000Z", redeemedAt: "2025-02-03T00:00:00.000Z", redeemedBranchId: "original-branch" },
  ]));
  const { app, connectDatabase } = await import("./index.js");
  await connectDatabase();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const resolved = await fs.realpath(temporary);
    assert.equal(resolved.toLowerCase(), path.resolve(temporary).toLowerCase());
    assert.ok(path.basename(resolved).startsWith("scratch-bulk-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const request = async (url, token, body, method = body ? "POST" : "GET") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { httpStatus: response.status, ...await response.json() };
  };
  const root = (await request("/api/auth/login", null, { loginId: "bulk-root", password: "Bulk-Root-Password" })).token;
  const owner = (await request("/api/auth/login", null, { email: "bulk-owner@example.test", password: "Bulk-Owner-Password" })).token;
  const branches = [];
  for (const name of ["Ameerpet", "Kukatpally", "Madhapur"]) {
    const response = await request("/api/portal/businesses/impact-vibes/branches", owner, { name });
    assert.equal(response.httpStatus, 201); branches.push(response.branch);
  }
  const draft = { businessId: "impact-vibes", language: "te", headline: "A surprise", offerTitle: "25% OFF",
    description: "Your next order", campaignName: "Summer", expiresAt: new Date(Date.now() + 86400000).toISOString(),
    branches: branches.map((branch) => ({ branchId: branch.branchId, quantity: 25 })), idempotencyKey: "test-batch-retry-key-001" };
  assert.equal((await request("/api/cards/bulk", null, draft)).httpStatus, 401);
  const before = (await request("/api/portal/cards", owner)).cards.length;
  for (const rows of [[{ branchId: "bad", quantity: 1 }], [{ branchId: branches[0].branchId, quantity: 0 }],
    [{ branchId: branches[0].branchId, quantity: 1.2 }], [draft.branches[0], draft.branches[0]]]) {
    const result = await request("/api/cards/bulk", owner, { ...draft, branches: rows });
    assert.equal(result.httpStatus, 400); assert.equal(result.savedCount, 0);
  }
  assert.equal((await request("/api/portal/cards", owner)).cards.length, before);
  for (const customerPhone of ["abc", 0, false, {}]) {
    const invalid = await request("/api/cards/bulk", owner, { ...draft, customerPhone });
    assert.equal(invalid.httpStatus, 400); assert.equal(invalid.savedCount, 0);
  }
  // A storage failure must leave the existing file unchanged and the batch
  // retryable. The injected fault only affects this isolated fixture's rename.
  const rename = fs.rename;
  try {
    fs.rename = async () => { throw Object.assign(new Error("Simulated disk failure"), { code: "EIO" }); };
    const failed = await request("/api/cards/bulk", owner, draft);
    assert.equal(failed.httpStatus, 503); assert.equal(failed.savedCount, 0);
    assert.equal((await request("/api/portal/cards", owner)).cards.length, before);
  } finally { fs.rename = rename; }
  const simultaneous = await Promise.all(Array.from({ length: 6 }, () => request("/api/cards/bulk", owner, draft)));
  for (const result of simultaneous) { assert.ok([200, 201].includes(result.httpStatus), result.message); assert.equal(result.savedCount, 75); }
  const batch = simultaneous[0];
  assert.equal(new Set(batch.coupons.map((card) => card.couponCode)).size, 75);
  assert.equal(new Set(batch.coupons.map((card) => card.slug)).size, 75);
  assert.equal((await request("/api/portal/cards", owner)).cards.length, before + 75);
  for (const branch of branches) assert.equal(batch.coupons.filter((card) => card.branchId === branch.branchId).length, 25);
  const disk = JSON.parse(await fs.readFile(path.join(dataDir, "cards.json"), "utf8"));
  assert.equal(disk[0].scratchedAt, disk[0].redeemedAt);
  assert.equal(disk[1].redeemedAt, "2025-02-01T00:00:00.000Z");
  assert.equal(disk[1].redeemedBranchId, "historical-branch");
  assert.equal(disk[1].disabled, true);
  assert.equal(disk[2].redeemedAt, "2025-02-03T00:00:00.000Z");
  assert.equal(disk[2].redeemedBranchId, "original-branch");
  assert.equal(disk.filter((card) => card.batchKey === batch.batchId).length, 75);
  for (const card of disk.filter((card) => card.batchKey)) {
    assert.equal(card.customerPhone, ""); assert.equal(card.language, "te"); assert.equal(card.campaignName, "Summer");
    assert.equal(card.redeemedAt, null); assert.equal(card.scratchedAt, null); assert.ok(card.createdAt);
  }
  assert.equal((await request("/api/cards/bulk", owner, { ...draft, offerTitle: "50% OFF" })).httpStatus, 409);
  const limits = { card: before + 75, branch: 5, account: 5 };
  assert.equal((await request("/api/portal/businesses/impact-vibes", root, { limits }, "PATCH")).httpStatus, 200);
  const retry = await request("/api/cards/bulk", owner, draft);
  assert.equal(retry.httpStatus, 200); assert.equal(retry.replayed, true); assert.equal(retry.savedCount, 75);
  const over = await request("/api/cards/bulk", owner, { ...draft, idempotencyKey: "new-batch-over-quota-001" });
  assert.equal(over.httpStatus, 403); assert.equal(over.savedCount, 0);
  assert.equal((await request("/api/portal/cards", owner)).cards.length, before + 75);
  const card = batch.coupons[0], branchId = card.branchId;
  assert.equal((await request(`/api/portal/cards/${card.slug}/redeem`, owner, { branchId })).httpStatus, 410);
  // A supplied branch cannot override the persisted assignment on a public claim.
  const revealed = await request(`/api/cards/${card.slug}/claim`, null, { branchId: branches[1].branchId });
  assert.equal(revealed.httpStatus, 200); assert.ok(revealed.redeemedAt);
  assert.equal(revealed.redeemedAt, revealed.scratchedAt); assert.equal(revealed.status, "redeemed");
  const saved = (await request("/api/portal/cards", owner)).cards.find((item) => item.slug === card.slug);
  assert.equal(saved.redeemedBranchId, branchId); assert.equal(saved.status, "redeemed");
  const publicCard = await request(`/api/cards/${card.slug}`);
  assert.equal(publicCard.branchName, "Ameerpet"); assert.equal(publicCard.used, true); assert.equal(publicCard.couponCode, undefined);
  for (const field of ["customerPhone", "batchKey", "batchFingerprint"]) assert.equal(publicCard[field], undefined);
  assert.equal((await request(`/api/portal/cards/${card.slug}/redeem`, owner, { branchId: branches[1].branchId })).httpStatus, 410);
  const redemptions = await Promise.all(Array.from({ length: 5 }, () => request(`/api/portal/cards/${card.slug}/redeem`, owner, { branchId })));
  assert.equal(redemptions.filter((result) => result.httpStatus === 410).length, 5);
  assert.equal((await request(`/api/cards/${card.slug}/claim`, null, {})).httpStatus, 409);
  assert.equal((await request(`/api/cards/${card.slug}`)).used, true);
  // Viewer and another tenant cannot create or redeem someone else's batch.
  const viewer = await request("/api/portal/users", root, { businessId: "impact-vibes", name: "Viewer", role: "viewer", password: "VIEWERPASS58" });
  const viewerToken = (await request("/api/auth/login", null, viewer.credentials)).token;
  assert.equal((await request("/api/cards/bulk", viewerToken, draft)).httpStatus, 403);
  assert.equal((await request(`/api/portal/cards/${batch.coupons[1].slug}/redeem`, viewerToken, { branchId })).httpStatus, 403);
  const other = await request("/api/portal/businesses", root, { name: "Other tenant", password: "OTHERBIZPASS58", limits: { card: 10, branch: 2, account: 1 } });
  const otherToken = (await request("/api/auth/login", null, other.credentials)).token;
  assert.equal((await request("/api/cards/bulk", otherToken, draft)).httpStatus, 403);
  assert.equal((await request(`/api/portal/cards/${batch.coupons[1].slug}/redeem`, otherToken, { branchId })).httpStatus, 404);
  // Separate batches racing for the final remaining allowance cannot exceed it.
  await request("/api/portal/businesses/impact-vibes", root, { limits: { ...limits, card: before + 80 } }, "PATCH");
  const race = await Promise.all(["a", "b"].map((key) => request("/api/cards/bulk", owner, {
    ...draft, idempotencyKey: `capacity-race-batch-${key}`, branches: [{ branchId, quantity: 5 }],
  })));
  assert.equal(race.filter((result) => result.httpStatus === 201).length, 1);
  assert.equal(race.filter((result) => result.httpStatus === 403).length, 1);
  assert.equal((await request("/api/portal/cards", owner)).cards.length, before + 80);
  const disabled = batch.coupons[2];
  assert.equal((await request(`/api/portal/cards/${disabled.slug}`, owner, { disabled: true }, "PATCH")).httpStatus, 200);
  assert.equal((await request(`/api/cards/${disabled.slug}/claim`, null, {})).httpStatus, 410);
  assert.equal((await request(`/api/portal/cards/${disabled.slug}/redeem`, owner, { branchId: disabled.branchId })).httpStatus, 410);
  // Replays still return original coupons if a branch is renamed/paused.
  assert.equal((await request(`/api/portal/businesses/impact-vibes/branches/${branches[0].branchId}`, owner, { name: "Renamed branch", status: "paused" }, "PATCH")).httpStatus, 200);
  assert.equal((await request("/api/cards/bulk", owner, draft)).savedCount, 75);
  const pausedBranchCard = batch.coupons[3];
  assert.equal((await request(`/api/cards/${pausedBranchCard.slug}/claim`, null, {})).httpStatus, 403);
  assert.equal((await request("/api/portal/cards", owner)).cards.find((item) => item.slug === pausedBranchCard.slug).used, false);
  const expired = batch.coupons.find((card) => card.branchId === branches[1].branchId);
  const expiredFixture = JSON.parse(await fs.readFile(path.join(dataDir, "cards.json"), "utf8"));
  expiredFixture.find((card) => card.slug === expired.slug).expiresAt = "2020-01-01T00:00:00Z";
  await fs.writeFile(path.join(dataDir, "cards.json"), JSON.stringify(expiredFixture));
  assert.equal((await request(`/api/cards/${expired.slug}/claim`, null, {})).httpStatus, 410);
  assert.equal((await request(`/api/portal/cards/${expired.slug}/redeem`, owner, { branchId: expired.branchId })).httpStatus, 410);
  assert.equal((await request(`/api/cards/${expired.slug}`)).httpStatus, 410);

  // Each imported number receives one private, persistent coupon assignment.
  await request("/api/portal/businesses/impact-vibes", root, { limits: { ...limits, card: before + 90 } }, "PATCH");
  const assignedDraft = { ...draft, idempotencyKey: "imported-recipient-batch-001",
    branches: [{ branchId: branches[1].branchId, quantity: 2 }, { branchId: branches[2].branchId, quantity: 1 }],
    recipients: [{ branchId: branches[1].branchId, customerPhone: "9876543210" },
      { branchId: branches[1].branchId, customerPhone: "+91 98765 43211" },
      { branchId: branches[2].branchId, customerPhone: "9876543212" }] };
  const assignedBefore = (await request("/api/portal/cards", owner)).cards.length;
  for (const recipients of [[], assignedDraft.recipients.slice(1),
    assignedDraft.recipients.map((row) => ({ ...row, branchId: branches[1].branchId })),
    [assignedDraft.recipients[0], { ...assignedDraft.recipients[1], customerPhone: "+919876543210" }, assignedDraft.recipients[2]],
    [assignedDraft.recipients[0], { ...assignedDraft.recipients[1], customerPhone: "invalid" }, assignedDraft.recipients[2]],
    [assignedDraft.recipients[0], { ...assignedDraft.recipients[1], branchId: branches[0].branchId }, assignedDraft.recipients[2]]]) {
    const invalid = await request("/api/cards/bulk", owner, { ...assignedDraft, recipients });
    assert.equal(invalid.httpStatus, 400, invalid.message); assert.equal(invalid.savedCount, 0);
  }
  assert.equal((await request("/api/portal/cards", owner)).cards.length, assignedBefore);
  assert.equal((await request("/api/cards/bulk", otherToken, assignedDraft)).httpStatus, 403);
  assert.equal((await request("/api/cards/bulk", viewerToken, assignedDraft)).httpStatus, 403);
  const assignedRace = await Promise.all(Array.from({ length: 4 }, () => request("/api/cards/bulk", owner, assignedDraft)));
  for (const result of assignedRace) { assert.ok([200, 201].includes(result.httpStatus), result.message); assert.equal(result.savedCount, 3); }
  const assignedBatch = assignedRace[0];
  assert.deepEqual(assignedBatch.coupons.map((card) => [card.branchId, card.customerPhone]), [
    [branches[1].branchId, "+919876543210"], [branches[1].branchId, "+919876543211"], [branches[2].branchId, "+919876543212"],
  ]);
  assert.equal((await request("/api/portal/cards", owner)).cards.length, assignedBefore + 3);
  const mapping = assignedBatch.coupons.map((card) => [card.slug, card.couponCode, card.customerPhone]);
  const recoveryUrl = (id = assignedBatch.batchId, businessId = "impact-vibes") =>
    `/api/portal/batches/${encodeURIComponent(id)}?businessId=${encodeURIComponent(businessId)}`;
  assert.equal((await request(recoveryUrl(), null)).httpStatus, 401);
  assert.equal((await request(recoveryUrl(), otherToken)).httpStatus, 403);
  assert.equal((await request(recoveryUrl(assignedBatch.batchId, other.business.businessId), owner)).httpStatus, 403);
  assert.equal((await request(recoveryUrl(assignedBatch.batchId, other.business.businessId), otherToken)).httpStatus, 404);
  assert.equal((await request(recoveryUrl("impact-vibes:missing-batch-key-001"), owner)).httpStatus, 404);
  assert.equal((await request(recoveryUrl("impact-vibes:short"), owner)).httpStatus, 404);
  assert.equal((await request(recoveryUrl(`${other.business.businessId}:foreign-batch-key-001`), owner)).httpStatus, 404);
  assert.equal((await request(`/api/portal/batches/${encodeURIComponent(assignedBatch.batchId)}`, root)).httpStatus, 400);
  assert.equal((await request(`${recoveryUrl()}&business=${encodeURIComponent(other.business.businessId)}`, root)).httpStatus, 403);
  const recovered = await request(recoveryUrl(), owner);
  assert.equal(recovered.httpStatus, 200); assert.equal(recovered.recovered, true); assert.equal(recovered.savedCount, 3);
  assert.deepEqual(recovered.coupons.map((card) => [card.slug, card.couponCode, card.customerPhone]), mapping);
  assert.ok(recovered.coupons.every((card) => card.status === "available"));
  assert.equal((await request(recoveryUrl(), root)).httpStatus, 200);
  assert.equal((await request(recoveryUrl(), viewerToken)).httpStatus, 200);
  const privateResponse = await fetch(`http://127.0.0.1:${server.address().port}${recoveryUrl()}`,
    { headers: { Authorization: `Bearer ${owner}` } });
  assert.equal(privateResponse.headers.get("cache-control"), "private, no-store");
  const assignedReplay = await request("/api/cards/bulk", owner, { ...assignedDraft, branches: [...assignedDraft.branches].reverse(),
    recipients: assignedDraft.recipients.map((row, index) => ({ ...row, customerPhone: `+91987654321${index}` })) });
  assert.equal(assignedReplay.httpStatus, 200); assert.equal(assignedReplay.replayed, true);
  assert.deepEqual(assignedReplay.coupons.map((card) => [card.slug, card.couponCode, card.customerPhone]), mapping);
  const changedMapping = await request("/api/cards/bulk", owner, { ...assignedDraft,
    recipients: [assignedDraft.recipients[1], assignedDraft.recipients[0], assignedDraft.recipients[2]] });
  assert.equal(changedMapping.httpStatus, 409); assert.equal(changedMapping.savedCount, 0);
  const persistedAssigned = JSON.parse(await fs.readFile(path.join(dataDir, "cards.json"), "utf8"))
    .filter((card) => card.batchKey === assignedBatch.batchId);
  assert.deepEqual(persistedAssigned.map((card) => [card.slug, card.couponCode, card.customerPhone]), mapping);
  const assignedPublic = await request(`/api/cards/${assignedBatch.coupons[0].slug}`);
  assert.equal(assignedPublic.customerPhone, undefined);
  const assignedClaim = await request(`/api/cards/${assignedBatch.coupons[0].slug}/claim`, null, {});
  assert.equal(assignedClaim.httpStatus, 200); assert.equal(assignedClaim.customerPhone, undefined);
  assert.equal((await request(`/api/cards/${assignedBatch.coupons[0].slug}`)).customerPhone, undefined);
  assert.equal((await request("/api/portal/cards", owner)).cards.find((card) => card.slug === assignedBatch.coupons[0].slug).customerPhone, "+919876543210");
  assert.equal((await request(recoveryUrl(), owner)).coupons[0].status, "redeemed");
  assert.equal((await request(`/api/portal/cards/${assignedBatch.coupons[0].slug}/redeem`, owner,
    { branchId: assignedBatch.coupons[0].branchId })).httpStatus, 410);
  assert.equal((await request(`/api/portal/cards/${assignedBatch.coupons[1].slug}`, owner,
    { disabled: true }, "PATCH")).httpStatus, 200);
  const recoveryFixture = JSON.parse(await fs.readFile(path.join(dataDir, "cards.json"), "utf8"));
  recoveryFixture.find((card) => card.slug === assignedBatch.coupons[2].slug).expiresAt = "2020-01-01T00:00:00Z";
  await fs.writeFile(path.join(dataDir, "cards.json"), JSON.stringify(recoveryFixture));
  const updatedRecovery = await request(recoveryUrl(), owner);
  assert.deepEqual(updatedRecovery.coupons.map((card) => card.status), ["redeemed", "disabled", "expired"]);
  assert.deepEqual(updatedRecovery.coupons.map((card) => [card.slug, card.couponCode, card.customerPhone]), mapping);
  assert.equal((await request("/api/portal/cards", owner)).cards.length, assignedBefore + 3);
  // The JSON limit permits a complete 1,000-number import; quota validation,
  // not a transport-size error, rejects this fixture's over-capacity batch.
  const largeImport = await request("/api/cards/bulk", owner, { ...assignedDraft, idempotencyKey: "large-recipient-import-001",
    branches: [{ branchId: branches[1].branchId, quantity: 1000 }],
    recipients: Array.from({ length: 1000 }, (_, index) => ({ branchId: branches[1].branchId, customerPhone: `+91${9000000000 + index}` })) });
  assert.equal(largeImport.httpStatus, 403); assert.equal(largeImport.savedCount, 0);
  assert.equal((await request("/api/portal/cards", owner)).cards.length, assignedBefore + 3);
});
