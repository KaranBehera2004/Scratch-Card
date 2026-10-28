import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("business branding is scoped, validated, persistent and snapshotted for single and bulk cards", async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "scratch-brand-test-"));
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: path.join(temporary, "no-env"), SCRATCH_DATA_ROOT: temporary, MONGODB_URI: "",
    AUTH_SECRET: "brand-fixture-isolated-private-secret",
    SUPER_ADMIN_EMAIL: "platform@example.test", SUPER_ADMIN_PASSWORD: "Platform-Test-Password",
    IMPACT_VIBES_EMAIL: "owner@example.test", IMPACT_VIBES_PASSWORD: "Owner-Test-Password",
  });
  for (const key of ["NETLIFY", "VERCEL", "AWS_LAMBDA_FUNCTION_NAME"]) delete process.env[key];
  const { app, connectDatabase } = await import("../src/app/index.js");
  await connectDatabase();
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    const resolved = await fs.realpath(temporary);
    assert.equal(resolved.toLowerCase(), path.join(await fs.realpath(os.tmpdir()), path.basename(temporary)).toLowerCase());
    assert.ok(path.basename(resolved).startsWith("scratch-brand-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const request = async (url, token, method = "GET", data) => {
    const response = await fetch(`${base}${url}`, { method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { ...await response.json(), status: response.status };
  };
  const login = async (email, password) => (await request("/api/auth/login", "", "POST", { email, password })).token;
  const root = await login("platform@example.test", "Platform-Test-Password");
  const owner = await login("owner@example.test", "Owner-Test-Password");
  const id = "impact-vibes", prefix = `/api/portal/businesses/${id}`;
  await request(prefix, root, "PATCH", { limits: { card: 100, branch: 10, department: 10, account: 10 } });
  const hierarchy = await request(`${prefix}/departments/branches`, owner, "POST", { departments: [
    { name: "North", branches: [{ name: "Sales" }] }, { name: "South", branches: [{ name: "Service" }] },
  ] });
  assert.equal(hierarchy.status, 201);
  const [north, south] = hierarchy.departments, [sales, service] = hierarchy.branches;
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  assert.equal((await request(`${prefix}/brand-settings`, "", "PATCH", { fixed: { name: "Partner" } })).status, 401);
  const fixed = await request(`${prefix}/brand-settings`, owner, "PATCH", { fixed: { name: "Partner", image } });
  assert.equal(fixed.status, 200, fixed.message);
  assert.match(fixed.fixed.image, /^\/api\/brand-images\/[a-f0-9]{64}$/);
  const configured = await request(`${prefix}/brand-settings/${north.departmentId}`, owner, "PATCH", { name: "North Brand", image });
  assert.equal(configured.status, 200, configured.message);
  assert.equal(configured.brand.image, fixed.fixed.image, "one stored asset shared by identical logos");
  const asset = await fetch(`${base}${fixed.fixed.image}`), bytes = Buffer.from(await asset.arrayBuffer());
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "image/webp");
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
  const logoFile = path.join(temporary, "server/data/brand-images", `${fixed.fixed.image.split("/").at(-1)}.webp`);
  await fs.writeFile(logoFile, "damaged image");
  const repairedLogo = await request(`${prefix}/brand-settings`, owner, "PATCH", { fixed: { name: "Partner", image } });
  assert.equal(repairedLogo.status, 200);
  assert.deepEqual(await fs.readFile(logoFile), bytes, "same-file re-upload repairs damaged local logos");
  await fs.unlink(logoFile);
  const missingLogo = await request(`${prefix}/brand-settings`, owner, "PATCH", { fixed: fixed.fixed });
  assert.equal(missingLogo.status, 400, "a missing logo cannot be reported as saved successfully");
  assert.match(missingLogo.message, /saved brand image is missing/);
  assert.equal((await request(`${prefix}/brand-settings`, owner, "PATCH", { fixed: { name: "Partner", image } })).status, 200);
  assert.equal((await fetch(`${base}/api/brand-images/bad`)).status, 404);
  assert.equal((await request(`${prefix}/brand-settings`, owner, "PATCH", { fixed: { name: "", image } })).status, 400);
  for (const invalid of ["javascript:alert(1)", "https://example.test/logo.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,AAAA"]) {
    assert.equal((await request(`${prefix}/brand-settings`, owner, "PATCH", { fixed: { name: "Bad", image: invalid } })).status, 400);
  }
  const business = (await request("/api/portal/businesses", owner)).businesses[0];
  assert.equal(business.departments.find(item => item.departmentId === north.departmentId).name, "North Brand");
  assert.equal(business.branches.find(item => item.branchId === sales.branchId).departmentId, north.departmentId);
  assert.deepEqual(business.brandSettings.fixed, fixed.fixed);
  const other = await request("/api/portal/businesses", root, "POST", { name: "Other", loginId: "BRANDOTHER88", password: "Other-Brand-Password", limits: { card: 10, branch: 2, department: 2, account: 2 } });
  assert.equal((await request(`/api/portal/businesses/${other.business.businessId}/brand-settings`, owner, "PATCH", { fixed: { name: "No" } })).status, 403);
  for (const role of ["editor", "viewer", "branch-staff"]) {
    const user = await request("/api/portal/users", owner, "POST", { businessId: id, role, name: role,
      loginId: role === "branch-staff" ? "BRANDSTAFF88" : undefined,
      email: `${role}@example.test`, password: "Brand-User-Password", branchId: role === "branch-staff" ? sales.branchId : undefined });
    assert.equal(user.status, 201, user.message);
    const token = await login(role === "branch-staff" ? "BRANDSTAFF88" : `${role}@example.test`, "Brand-User-Password");
    assert.equal((await request(`${prefix}/brand-settings`, token, "PATCH", { fixed: { name: "No" } })).status, 403);
  }
  const draft = { businessId: id, headline: "Surprise", offerTitle: "25% OFF", description: "Next visit", customerPhone: "9876543210" };
  const create = async details => {
    const response = await request("/api/cards", owner, "POST", { ...draft, ...details });
    assert.equal(response.status, 201, response.message);
    return request(`/api/cards/${response.slug}`);
  };
  const automatic = await create({ branchId: sales.branchId, fixedBrand: { name: "Forged" } });
  assert.deepEqual(automatic.normalBrand, { name: "North Brand", image: configured.brand.image });
  assert.deepEqual(automatic.fixedBrand, fixed.fixed);
  const themedCard = await create({ branchId: sales.branchId, ticketColor: "#342d58", ticketTextColor: "#ffffff" });
  assert.equal(themedCard.ticketColor, "#342d58", "the reward-card color is saved and returned for the shared card");
  assert.equal(themedCard.ticketTextColor, "#ffffff", "the reward-card text color is saved independently");
  assert.equal((await request(prefix, owner, "PATCH", { cardImagesEnabled: false })).status, 403);
  assert.equal((await request(prefix, root, "PATCH", { cardImagesEnabled: false })).status, 200);
  const withoutImages = await create({ branchId: sales.branchId });
  assert.equal(withoutImages.normalBrand.name, "North Brand");
  assert.equal(withoutImages.normalBrand.image, "");
  assert.equal(withoutImages.fixedBrand.name, "Partner");
  assert.equal(withoutImages.fixedBrand.image, "");
  const restoredImages = await request(`${prefix}/brand-settings/${north.departmentId}`, owner, "PATCH", {
    name: "North Brand", image,
  });
  assert.equal(restoredImages.status, 200, restoredImages.message);
  assert.equal((await request("/api/portal/businesses", owner)).businesses[0].cardImagesEnabled, true,
    "saving a logo makes card images usable from the business dashboard");
  assert.equal((await create({ branchId: sales.branchId })).normalBrand.image, configured.brand.image);
  assert.equal((await request(prefix, root, "PATCH", { cardImagesEnabled: true })).status, 200);
  assert.equal((await request(`/api/cards/${automatic.slug}`)).normalBrand.image, configured.brand.image,
    "existing cards retain their saved logo when images are turned off for future cards");
  assert.equal(automatic.couponCode, undefined);
  assert.equal(automatic.customerPhone, undefined);
  const resized = await create({ branchId: sales.branchId, normalLogoScale: 135, fixedLogoScale: 65 });
  assert.equal(resized.normalBrand.logoScale, 135);
  assert.equal(resized.fixedBrand.logoScale, 65);
  assert.equal((await request("/api/cards", owner, "POST", { ...draft, branchId: sales.branchId, normalLogoScale: 145 })).status, 400);
  const selected = await create({ branchId: sales.branchId, displayBrandId: south.departmentId });
  assert.equal(selected.normalBrand.name, "South");
  assert.equal(selected.branchId, sales.branchId, "branding does not change redemption assignment");
  const all = await create({});
  assert.equal(all.normalBrand, null); assert.equal(all.fixedBrand.name, "Partner");
  assert.equal((await request("/api/cards", owner, "POST", { ...draft, displayBrandId: "foreign-brand" })).status, 400);
  const payload = { ...draft, idempotencyKey: "brand-batch-retry-001", branches: [
    { branchId: sales.branchId, quantity: 1 }, { branchId: service.branchId, quantity: 1 },
  ] };
  const bulk = await request("/api/cards/bulk", owner, "POST", payload);
  assert.equal(bulk.status, 201, bulk.message);
  assert.deepEqual(bulk.coupons.map(card => card.normalBrand.name), ["North Brand", "South"]);
  assert.ok(bulk.coupons.every(card => card.fixedBrand.name === "Partner"));
  await request(`${prefix}/brand-settings`, owner, "PATCH", { fixed: { name: "", image: "" } });
  await request(`${prefix}/brand-settings/${north.departmentId}`, owner, "PATCH", { name: "Renamed North", image: "" });
  const replay = await request("/api/cards/bulk", owner, "POST", payload);
  assert.equal(replay.status, 200); assert.equal(replay.replayed, true);
  assert.deepEqual(replay.coupons, bulk.coupons, "branding updates never break idempotent retries");
  const persisted = await request(`/api/cards/${automatic.slug}`);
  assert.equal(persisted.normalBrand.name, "North Brand"); assert.equal(persisted.fixedBrand.name, "Partner");
  const fresh = await create({ branchId: sales.branchId });
  assert.equal(fresh.fixedBrand, null); assert.equal(fresh.normalBrand.name, "Renamed North");

  const createWorkspace = async (name, loginId, structureMode) => {
    const response = await request("/api/portal/businesses", root, "POST", {
      name, loginId, password: "Workspace-Mode-Password", structureMode,
      limits: { card: 20, branch: 5, department: 5, account: 2 },
    });
    assert.equal(response.status, 201, response.message);
    return response.business;
  };
  const branchOnly = await createWorkspace("Branch Only", "BRANCHONLY88", "branch-only");
  const branchOnlyPrefix = `/api/portal/businesses/${branchOnly.businessId}`;
  assert.equal((await request(`${branchOnlyPrefix}/departments/branches`, root, "POST", {
    departments: [{ name: "Hidden", branches: [{ name: "Child" }] }],
  })).status, 400);
  const downtown = await request(`${branchOnlyPrefix}/branches`, root, "POST", { name: "Downtown" });
  assert.equal(downtown.status, 201, downtown.message);
  assert.equal((await request("/api/cards", root, "POST", { ...draft, businessId: branchOnly.businessId })).status, 400,
    "single-level cards must select their branch");
  const branchCard = await request("/api/cards", root, "POST", {
    ...draft, businessId: branchOnly.businessId, branchId: downtown.branch.branchId,
  });
  assert.equal(branchCard.status, 201, branchCard.message);
  const publicBranchCard = await request(`/api/cards/${branchCard.slug}`);
  assert.equal(publicBranchCard.branchName, "Downtown");
  assert.equal(publicBranchCard.normalBrand, null);
  assert.equal((await request(branchOnlyPrefix, root, "PATCH", { structureMode: "brand-only" })).status, 409,
    "unassigned branches cannot be silently hidden by changing to Brand-only");

  const brandOnly = await createWorkspace("Brand Only", "BRANDONLY88", "brand-only");
  const brandOnlyPrefix = `/api/portal/businesses/${brandOnly.businessId}`;
  assert.equal((await request(`${brandOnlyPrefix}/branches`, root, "POST", { name: "Hidden department" })).status, 400);
  assert.equal((await request(`${brandOnlyPrefix}/departments/branches`, root, "POST", {
    departments: [{ name: "Plum", branches: [{ name: "Different" }] }],
  })).status, 400);
  const plum = await request(`${brandOnlyPrefix}/departments/branches`, root, "POST", {
    departments: [{ name: "Plum", branches: [{ name: "Plum" }] }],
  });
  assert.equal(plum.status, 201, plum.message);
  assert.equal((await request("/api/cards", root, "POST", { ...draft, businessId: brandOnly.businessId })).status, 400,
    "single-level cards must select their brand");
  const plumCard = await request("/api/cards", root, "POST", {
    ...draft, businessId: brandOnly.businessId, branchId: plum.branches[0].branchId,
  });
  assert.equal(plumCard.status, 201, plumCard.message);
  const publicPlumCard = await request(`/api/cards/${plumCard.slug}`);
  assert.equal(publicPlumCard.branchName, "Plum");
  assert.equal(publicPlumCard.normalBrand.name, "Plum");
  const renamed = await request(`${brandOnlyPrefix}/brand-settings/${plum.departments[0].departmentId}`,
    root, "PATCH", { name: "Plum Plus" });
  assert.equal(renamed.status, 200, renamed.message);
  const refreshedBrand = (await request("/api/portal/businesses", root)).businesses.find(item => item.businessId === brandOnly.businessId);
  assert.equal(refreshedBrand.branches[0].name, "Plum Plus", "the internal redemption unit follows a brand rename");
});
