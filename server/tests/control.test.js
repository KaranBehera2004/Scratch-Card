import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

test("SaaS permissions, persistence, and one-time rewards", async (t) => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "scratch-control-test-"),
  );
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: path.join(temporary, "no-env"),
    SCRATCH_DATA_ROOT: temporary,
    MONGODB_URI: "",
    AUTH_SECRET: "isolated-test-secret-with-enough-entropy",
    SUPER_ADMIN_EMAIL: "platform@example.test",
    SUPER_ADMIN_PASSWORD: "Platform-Test-Password",
    IMPACT_VIBES_EMAIL: "owner@example.test",
    IMPACT_VIBES_PASSWORD: "Owner-Test-Password",
  });
  for (const key of ["NETLIFY", "VERCEL", "AWS_LAMBDA_FUNCTION_NAME"])
    delete process.env[key];
  const { app, connectDatabase } = await import("../src/app/index.js");
  await connectDatabase();
  // Simulate an existing business with a saved plan before this upgrade.
  const businessesPath = path.join(temporary, "server/data/businesses.json");
  const legacyBusinesses = JSON.parse(
    await fs.readFile(businessesPath, "utf8"),
  );
  legacyBusinesses[0].planId = "starter";
  await fs.writeFile(businessesPath, JSON.stringify(legacyBusinesses));
  await fs.writeFile(
    path.join(temporary, "server/data/control.json"),
    JSON.stringify({
      plans: [{ id: "starter", cardLimit: 100, branchLimit: 2, userLimit: 0 }],
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const resolved = await fs.realpath(temporary);
    // Compare real paths: Windows can report TEMP as an 8.3 short name.
    assert.equal(resolved.toLowerCase(),
      path.join(await fs.realpath(os.tmpdir()), path.basename(temporary)).toLowerCase());
    assert.ok(path.basename(resolved).startsWith("scratch-control-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const request = async (url, token, method = "GET", body) => {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(await response.json()), status: response.status };
  };
  const login = async (email, password) => {
    const result = await request("/api/auth/login", null, "POST", {
      email,
      password,
    });
    assert.equal(result.status, 200, result.message);
    return result.token;
  };
  const admin = await login("platform@example.test", "Platform-Test-Password"),
    owner = await login("owner@example.test", "Owner-Test-Password");
  const health = await fetch(`${base}/api/health`, {
    headers: { "If-None-Match": "W/\"stale-production-response\"" },
  });
  assert.equal(health.status, 200);
  assert.match(health.headers.get("cache-control"), /no-store/);
  const draft = {
    businessId: "impact-vibes",
    senderName: "Forged sender",
    headline: "A surprise for you",
    offerTitle: "25% OFF",
    description: "Your next order",
    campaignName: "Diwali",
    customerPhone: "+919876543210",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const previewImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  let otherId, branchId, cardSlug, viewer, editor, viewerId;

  await t.test("platform customization persists without altering existing businesses", async () => {
    const original = (await request("/api/portal/settings", admin)).settings;
    const updated = { ...original, supportUrl: "https://example.test/help", loginMessage: "Welcome to your rewards portal", defaultLimits: { card: 500, branch: 5, department: 3, account: 2 } };
    assert.equal((await request("/api/portal/settings", owner, "PUT", updated)).status, 403);
    assert.equal((await request("/api/portal/settings", admin, "PUT", updated)).status, 200);
    assert.deepEqual((await request("/api/portal/settings", admin)).settings, updated);
    const publicSettings = await request("/api/platform");
    assert.equal(publicSettings.supportUrl, updated.supportUrl);
    assert.equal(publicSettings.loginMessage, updated.loginMessage);
    assert.equal(publicSettings.defaultLimits, undefined);
    assert.deepEqual((await request("/api/portal/businesses", owner)).businesses[0].limits, { card: 100, branch: 2, department: 2, account: 0 });
    const stored = JSON.parse(await fs.readFile(path.join(temporary, "server/data/control.json"), "utf8"));
    assert.deepEqual(stored.settings, updated);
    for (const supportUrl of ["javascript:alert(1)", "invalid", "https://user:password@example.test"])
      assert.equal((await request("/api/portal/settings", admin, "PUT", { ...updated, supportUrl })).status, 400);
    for (const card of [-1, 1.5, "", null])
      assert.equal((await request("/api/portal/settings", admin, "PUT", { ...updated, defaultLimits: { ...updated.defaultLimits, card } })).status, 400);
    assert.deepEqual((await request("/api/portal/settings", admin)).settings, updated);
    assert.equal((await request("/api/portal/settings", admin, "PUT", original)).status, 200);
  });

  await t.test(
    "saved allowances survive removing the plans screen",
    async () => {
      const existing = (await request("/api/portal/businesses", owner))
        .businesses[0];
      assert.deepEqual(existing.limits, { card: 100, branch: 2, department: 2, account: 0 });
    },
  );

  await t.test(
    "authentication and cross-business access are enforced",
    async () => {
      assert.equal((await request("/api/portal/cards")).status, 401);
      assert.equal((await request("/api/portal/settings", owner)).status, 403);
      const result = await request("/api/portal/businesses", admin, "POST", {
        name: "Second business",
        loginEmail: "second@example.test",
        password: "Second-Test-Password",
        limits: { card: 100, branch: 2, account: 1 },
      });
      assert.equal(result.status, 201, result.message);
      otherId = result.business.businessId;
      assert.equal(result.business.passwordHash, undefined);
      assert.deepEqual(result.business.limits, {
        card: 100,
        branch: 2,
        department: 2,
        account: 1,
      });
      assert.equal(
        (await request("/api/portal/businesses", owner)).businesses.length,
        1,
      );
      assert.equal(
        (await request(`/api/portal/cards?business=${otherId}`, owner)).status,
        403,
      );
      assert.equal(
        (
          await request("/api/cards", owner, "POST", {
            ...draft,
            businessId: otherId,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            `/api/portal/businesses/${otherId}?business=impact-vibes`,
            owner,
            "PATCH",
            { website: "https://example.test" },
          )
        ).status,
        403,
      );
      const updatedProfile = await request(
        "/api/portal/businesses/impact-vibes",
        owner,
        "PATCH",
        { name: "Impact Vibes Rewards", website: "https://impact.example.test" },
      );
      assert.equal(updatedProfile.status, 200, updatedProfile.message);
      let ownBusiness = (await request("/api/portal/businesses", owner)).businesses[0];
      assert.equal(ownBusiness.name, "Impact Vibes Rewards");
      assert.equal(ownBusiness.website, "https://impact.example.test/");
      assert.equal((await request(
        "/api/portal/businesses/impact-vibes", owner, "PATCH",
        { limits: { card: 1, branch: 1, department: 1, account: 1 } },
      )).status, 403);
      assert.equal((await request(
        "/api/portal/businesses/impact-vibes", owner, "PATCH",
        { name: "Impact Vibes", website: "" },
      )).status, 200);
      ownBusiness = (await request("/api/portal/businesses", owner)).businesses[0];
      assert.equal(ownBusiness.name, "Impact Vibes");
    },
  );
  await t.test(
    "branches and cards persist scoped metadata and enforce sender identity",
    async () => {
      const result = await request(
        "/api/portal/businesses/impact-vibes/branches",
        owner,
        "POST",
        { name: "Hyderabad", address: "City center" },
      );
      assert.equal(result.status, 201);
      const hierarchy = await request(
        "/api/portal/businesses/impact-vibes/departments/branches", owner, "POST",
        { departments: [{ name: "Sales", branches: [{ name: "Secunderabad", address: "Showroom" }] }] },
      );
      assert.equal(hierarchy.status, 201, hierarchy.message);
      assert.equal(hierarchy.departments.length, 1);
      assert.equal(hierarchy.branches.length, 1);
      assert.equal(hierarchy.branches[0].departmentId, hierarchy.departments[0].departmentId);
      branchId = hierarchy.branches[0].branchId;
      assert.equal(
        (
          await request("/api/cards", owner, "POST", {
            ...draft,
            branchId: "another-business-branch",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/api/cards", owner, "POST", {
            ...draft,
            expiresAt: "2020-01-01",
          })
        ).status,
        400,
      );
      const created = await request("/api/cards", owner, "POST", {
        ...draft,
        branchId,
        branchName: "Forged branch",
        language: "hi",
        couponCode: "TEST-UNIQUE",
        customerPhone: "+91 (98765) 43210",
        shareTitle: "Congratulation you got an offer",
        shareImage: `data:image/png;base64,${previewImageBase64}`,
      });
      assert.equal(created.status, 201, created.message);
      cardSlug = created.slug;
      const cards = (await request("/api/portal/cards", owner)).cards;
      assert.equal(cards[0].senderName, "Impact Vibes");
      assert.equal(cards[0].campaignName, "Diwali");
      assert.equal(cards[0].branchId, branchId);
      assert.equal(cards[0].branchName, "Secunderabad");
      assert.equal(cards[0].shareTitle, "Congratulation you got an offer");
      assert.equal(cards[0].language, "hi");
      assert.equal(cards[0].customerPhone, "+919876543210");
      assert.equal(cards[0].hasShareImage, true);
      assert.equal(cards[0].shareImageBase64, undefined);
      assert.equal((await request("/api/admin/coupons", owner)).coupons[0].customerPhone, "+919876543210");
      const publicResult = await request(`/api/cards/${cardSlug}`);
      assert.equal(publicResult.customerPhone, undefined);
      assert.ok(!JSON.stringify(publicResult).includes("9876543210"));
      assert.ok(publicResult.openedAt);
      assert.equal(publicResult.couponCode, undefined);
      const openedCard = (await request("/api/portal/cards", owner)).cards.find(
        (card) => card.slug === cardSlug,
      );
      assert.equal(openedCard.status, "opened");
      assert.equal(openedCard.openedAt, publicResult.openedAt);
      assert.equal((await request(`/api/cards/${cardSlug}`)).openedAt, publicResult.openedAt);
      assert.equal(publicResult.hasShareImage, true);
      assert.equal(publicResult.shareTitle, "Congratulation you got an offer");
      assert.equal(publicResult.shareImageBase64, undefined);
      const savedCards = JSON.parse(await fs.readFile(path.join(temporary, "server/data/cards.json"), "utf8"));
      assert.equal(savedCards.find((card) => card.slug === cardSlug).customerPhone, "+919876543210");
      assert.equal(savedCards.find((card) => card.slug === cardSlug).shareImageBase64, previewImageBase64);
      const imageResponse = await fetch(`${base}/api/cards/${cardSlug}/share-image`);
      assert.equal(imageResponse.status, 200);
      assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
      const optimizedImage = Buffer.from(await imageResponse.arrayBuffer());
      assert.deepEqual(optimizedImage.subarray(0, 3), Buffer.from("ffd8ff", "hex"));
      assert.ok(optimizedImage.length < 300 * 1024);
      const previewResponse = await fetch(`${base}/share/${cardSlug}?v=5`);
      const previewHtml = await previewResponse.text();
      assert.equal(previewResponse.status, 200);
      assert.match(previewHtml, /property="og:image"/);
      assert.match(previewHtml, /property="og:title" content="Congratulation you got an offer"/);
      assert.match(previewHtml, /property="og:description" content="A surprise is waiting for you\. Open the scratch card to reveal your offer\."/);
      assert.doesNotMatch(previewHtml, /25% OFF/);
      assert.match(previewHtml, new RegExp(`scratch\\.justconnect\\.biz/share/${cardSlug}/image\\?v=5`));
      assert.match(previewHtml, new RegExp(`scratch\\.justconnect\\.biz/card/${cardSlug}`));
      assert.doesNotMatch(previewHtml, /http-equiv="refresh"/i);
      assert.match(previewHtml, /property="og:image:type" content="image\/jpeg"/);
      assert.match(previewHtml, /property="og:image:width" content="1200"/);
      assert.match(previewHtml, /property="og:image:height" content="630"/);
      assert.equal((await request("/api/cards", owner, "POST", {
        ...draft, shareImage: "data:text/html;base64,PGgxPkJhZDwvaDE+",
      })).status, 400);
      assert.equal((await request(`/api/cards/${cardSlug}`)).language, "hi");
      assert.equal((await request("/api/cards", owner, "POST", { ...draft, language: "invalid" })).status, 400);
      assert.equal(
        (await request(`/api/cards/${cardSlug}`)).branchName,
        "Secunderabad",
      );
      assert.ok(cards[0].expiresAt);
      assert.equal(
        (await request(`/api/cards/${cardSlug}`)).couponCode,
        undefined,
      );
      assert.equal(
        (
          await request("/api/cards", owner, "POST", {
            ...draft,
            couponCode: "test-unique",
          })
        ).status,
        409,
      );
      const second = await login("second@example.test", "Second-Test-Password");
      assert.equal(
        (await request("/api/portal/cards", second)).cards.length,
        0,
      );
      assert.equal((await request("/api/admin/coupons", second)).coupons.length, 0);
      assert.equal(
        (
          await request(`/api/portal/cards/${cardSlug}`, second, "PATCH", {
            disabled: true,
          })
        ).status,
        404,
      );
      assert.equal((await request(
        `/api/portal/businesses/impact-vibes/branches/${result.branch.branchId}`,
        owner, "DELETE",
      )).status, 200);
      let ownerBusiness = (await request("/api/portal/businesses", owner)).businesses[0];
      assert.equal(ownerBusiness.branches.some((item) => item.branchId === result.branch.branchId), false);
      let adminBusiness = (await request("/api/portal/businesses", admin)).businesses
        .find((item) => item.businessId === "impact-vibes");
      assert.equal(adminBusiness.branches.find((item) => item.branchId === result.branch.branchId).status, "deleted");

      const disposable = await request(
        "/api/portal/businesses/impact-vibes/departments/branches", owner, "POST",
        { departments: [{ name: "Temporary operations", branches: [{ name: "Temporary branch" }] }] },
      );
      assert.equal(disposable.status, 201, disposable.message);
      assert.equal((await request(
        `/api/portal/businesses/impact-vibes/departments/${disposable.departments[0].departmentId}`,
        owner, "DELETE",
      )).status, 200);
      ownerBusiness = (await request("/api/portal/businesses", owner)).businesses[0];
      assert.equal(ownerBusiness.departments.some((item) => item.departmentId === disposable.departments[0].departmentId), false);
      assert.equal(ownerBusiness.branches.some((item) => item.branchId === disposable.branches[0].branchId), false);
      adminBusiness = (await request("/api/portal/businesses", admin)).businesses
        .find((item) => item.businessId === "impact-vibes");
      assert.equal(adminBusiness.departments.find((item) => item.departmentId === disposable.departments[0].departmentId).status, "deleted");
      assert.equal(adminBusiness.branches.find((item) => item.branchId === disposable.branches[0].branchId).status, "deleted");
      assert.equal((await request(
        `/api/portal/businesses/impact-vibes/departments/${disposable.departments[0].departmentId}/restore`,
        owner, "POST", {},
      )).status, 403);
      const restoredDepartment = await request(
        `/api/portal/businesses/impact-vibes/departments/${disposable.departments[0].departmentId}/restore`,
        admin, "POST", {},
      );
      assert.equal(restoredDepartment.status, 200, restoredDepartment.message);
      assert.equal(restoredDepartment.branches.length, 1);
      ownerBusiness = (await request("/api/portal/businesses", owner)).businesses[0];
      assert.equal(ownerBusiness.departments.some((item) => item.departmentId === disposable.departments[0].departmentId), true);
      assert.equal(ownerBusiness.branches.some((item) => item.branchId === disposable.branches[0].branchId), true);
      assert.equal((await request(
        `/api/portal/businesses/impact-vibes/departments/${disposable.departments[0].departmentId}`,
        owner, "DELETE",
      )).status, 200);

      const restoredBranch = await request(
        `/api/portal/businesses/impact-vibes/branches/${result.branch.branchId}/restore`,
        admin, "POST", {},
      );
      assert.equal(restoredBranch.status, 200, restoredBranch.message);
      ownerBusiness = (await request("/api/portal/businesses", owner)).businesses[0];
      assert.equal(ownerBusiness.branches.some((item) => item.branchId === result.branch.branchId), true);
      assert.equal((await request(
        `/api/portal/businesses/impact-vibes/branches/${result.branch.branchId}`,
        owner, "DELETE",
      )).status, 200);
    },
  );
  await t.test("location names can repeat and department names are unique only within their location", async () => {
    const created = await request("/api/portal/businesses", admin, "POST", {
      name: "Repeated location names", password: "Location-Test-Password",
      limits: { card: 0, branch: 0, department: 0, account: 0 },
    });
    assert.equal(created.status, 201, created.message);
    const basePath = `/api/portal/businesses/${created.business.businessId}`;
    const hierarchyPath = `${basePath}/departments/branches`;
    const makeLocation = () => ({ name: "Ameerpet", branches: [{ name: "Sales" }, { name: "Service" }] });
    // Both one submission and subsequent submissions may reuse location/unit names.
    const hierarchy = await request(hierarchyPath, admin, "POST", {
      departments: [makeLocation(), makeLocation()],
    });
    assert.equal(hierarchy.status, 201, hierarchy.message);
    assert.equal(new Set(hierarchy.departments.map((item) => item.departmentId)).size, 2);
    assert.equal(new Set(hierarchy.branches.map((item) => item.branchId)).size, 4);
    assert.equal((await request(hierarchyPath, admin, "POST", { departments: [makeLocation()] })).status, 201);
    const [first, second] = hierarchy.departments;
    const firstSales = hierarchy.branches.find((item) => item.departmentId === first.departmentId && item.name === "Sales");
    const firstService = hierarchy.branches.find((item) => item.departmentId === first.departmentId && item.name === "Service");
    const before = (await request(`/api/portal/businesses?business=${created.business.businessId}`, admin)).businesses
      .find((item) => item.businessId === created.business.businessId);
    const duplicateHierarchy = await request(hierarchyPath, admin, "POST", {
      departments: [{ name: "Another location", branches: [{ name: "Sales" }, { name: " sales " }] }],
    });
    assert.equal(duplicateHierarchy.status, 400);
    const after = (await request(`/api/portal/businesses?business=${created.business.businessId}`, admin)).businesses
      .find((item) => item.businessId === created.business.businessId);
    assert.deepEqual(after.departments, before.departments);
    assert.deepEqual(after.branches, before.branches);
    const addUnit = (departmentId, name) => request(`${basePath}/branches`, admin, "POST", { departmentId, name });
    assert.equal((await addUnit(first.departmentId, " SALES ")).status, 400);
    const support = await addUnit(first.departmentId, "Support");
    assert.equal(support.status, 201, support.message);
    assert.equal((await addUnit(second.departmentId, "Support")).status, 201);
    assert.equal((await addUnit("", "Unassigned name")).status, 201);
    assert.equal((await addUnit("", "Unassigned name")).status, 201);
    const unitPath = (unit) => `${basePath}/branches/${unit.branchId}`;
    assert.equal((await request(unitPath(firstService), admin, "PATCH", { name: " sales " })).status, 400);
    assert.equal((await request(unitPath(support.branch), admin, "PATCH", { departmentId: second.departmentId })).status, 400);
    assert.equal((await request(unitPath(firstSales), admin, "PATCH", { name: " SALES " })).status, 200);
    assert.equal((await request(unitPath(firstSales), admin, "DELETE")).status, 200);
    const replacement = await addUnit(first.departmentId, "Sales");
    assert.equal(replacement.status, 201, replacement.message);
    assert.equal((await request(`${unitPath(firstSales)}/restore`, admin, "POST", {})).status, 400);
    assert.equal((await request(unitPath(replacement.branch), admin, "DELETE")).status, 200);
    assert.equal((await request(`${unitPath(firstSales)}/restore`, admin, "POST", {})).status, 200);
    // Restoring a same-name location retains its own units and their original IDs.
    const locationPath = `${basePath}/departments/${first.departmentId}`;
    assert.equal((await request(locationPath, admin, "DELETE")).status, 200);
    const restored = await request(`${locationPath}/restore`, admin, "POST", {});
    assert.equal(restored.status, 200, restored.message);
    assert.ok(restored.branches.some((item) => item.branchId === firstSales.branchId));
    assert.equal((await request(basePath, admin, "DELETE", { confirmName: created.business.name })).status, 200);
  });
  await t.test("WhatsApp numbers are mandatory and invalid values never save cards", async () => {
    const before = (await request("/api/portal/cards", owner)).cards.length;
    for (const customerPhone of [undefined, null, "", "   "]) {
      const result = await request("/api/cards", owner, "POST", { ...draft, customerPhone });
      assert.equal(result.status, 400);
      assert.equal(result.message, "Enter the customer's WhatsApp number.");
    }
    for (const customerPhone of ["abc", "123", "1234567890123456", "++919876543210", "9876543210 ext 1", {}, 9876543210]) {
      const result = await request("/api/cards", owner, "POST", { ...draft, customerPhone });
      assert.equal(result.status, 400);
      assert.equal(result.message, "Enter a valid WhatsApp number with country code, or a 10-digit Indian mobile number.");
    }
    assert.equal((await request("/api/portal/cards", owner)).cards.length, before);
  });
  await t.test(
    "staff roles enforce permissions and account changes revoke sessions",
    async () => {
      const result = await request("/api/portal/users", owner, "POST", {
        name: "Read-only teammate",
        email: "viewer@example.test",
        password: "Viewer-Test-Password",
        role: "viewer",
      });
      assert.equal(result.status, 201);
      viewerId = result.user.id;
      assert.equal(result.user.passwordHash, undefined);
      viewer = await login("viewer@example.test", "Viewer-Test-Password");
      assert.equal((await request("/api/portal/cards", viewer)).status, 200);
      assert.equal(
        (await request("/api/cards", viewer, "POST", draft)).status,
        403,
      );
      assert.equal((await request("/api/portal/users", viewer)).status, 403);
      assert.equal(
        (
          await request(
            "/api/portal/businesses/impact-vibes/branches",
            viewer,
            "POST",
            { name: "Forbidden" },
          )
        ).status,
        403,
      );
      const changed = await request(
        `/api/portal/users/${viewerId}`,
        owner,
        "PATCH",
        { role: "editor" },
      );
      assert.equal(changed.status, 200);
      assert.equal((await request("/api/portal/cards", viewer)).status, 401);
      editor = await login("viewer@example.test", "Viewer-Test-Password");
      assert.equal(
        (await request("/api/cards", editor, "POST", draft)).status,
        201,
      );
      assert.equal((await request("/api/portal/users", editor)).status, 403);
    },
  );
  await t.test(
    "scratching is atomic and remains pending until branch staff redemption",
    async () => {
      assert.equal(
        (
          await request(`/api/portal/cards/${cardSlug}`, owner, "PATCH", {
            disabled: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (await request(`/api/cards/${cardSlug}/claim`, null, "POST", {}))
          .status,
        410,
      );
      assert.equal(
        (
          await request(`/api/portal/cards/${cardSlug}`, owner, "PATCH", {
            disabled: false,
          })
        ).status,
        200,
      );
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(`/api/cards/${cardSlug}/claim`, null, "POST", {}),
        ),
      );
      assert.equal(results.filter((item) => item.status === 200).length, 1);
      assert.equal(results.filter((item) => item.status === 409).length, 5);
      const winner = results.find((item) => item.status === 200);
      assert.ok(winner.scratchedAt);
      assert.equal(winner.redeemedAt, null);
      for (const result of results) {
        assert.equal(result.customerPhone, undefined);
        assert.ok(!JSON.stringify(result).includes("9876543210"));
      }
      assert.equal((await request(`/api/cards/${cardSlug}`)).customerPhone, undefined);
      assert.equal(winner.couponCode, "TEST-UNIQUE");
      assert.equal((await request(`/api/cards/${cardSlug}`)).used, true);
      assert.equal((await request(`/api/cards/${cardSlug}`)).couponCode, "TEST-UNIQUE");
      const scratched = (await request("/api/portal/cards", owner)).cards.find((item) => item.slug === cardSlug);
      assert.equal(scratched.status, "scratched");
      assert.equal(scratched.used, false);
      assert.equal(scratched.revealed, true);
      assert.equal(scratched.redeemedBranchId || "", "");
      assert.equal((await request(`/api/portal/cards/${cardSlug}/redeem`, null, "POST", { branchId })).status, 401);
      const redemptions = await Promise.all(Array.from({ length: 6 }, () => request(`/api/portal/cards/${cardSlug}/redeem`, owner, "POST", { branchId })));
      assert.equal(redemptions.filter((item) => item.status === 410).length, 6);
      assert.equal((await request(`/api/cards/${cardSlug}`)).used, true);
      assert.equal(
        (await request("/api/portal/cards", owner)).cards.find(
          (item) => item.slug === cardSlug,
        ).status,
        "scratched",
      );
      assert.equal(
        (
          await request(`/api/portal/cards/${cardSlug}`, owner, "PATCH", {
            disabled: false,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "business limits and global controls block prohibited creation",
    async () => {
      assert.equal(
        (
          await request("/api/portal/businesses/impact-vibes", admin, "PATCH", {
            limits: { card: 1, branch: 1, department: 1, account: 2 },
          })
        ).status,
        200,
      );
      assert.deepEqual(
        (await request("/api/portal/businesses", owner)).businesses[0].limits,
        { card: 1, branch: 1, department: 1, account: 2 },
      );
      assert.equal(
        (
          await request("/api/portal/businesses/impact-vibes", owner, "PATCH", {
            limits: { card: 0, branch: 0, department: 0, account: 0 },
          })
        ).status,
        403,
      );
      for (const invalid of [-1, 1.5, "", null, true]) {
        assert.equal(
          (
            await request(
              "/api/portal/businesses/impact-vibes",
              admin,
              "PATCH",
              { limits: { card: invalid, branch: 2, department: 2, account: 1 } },
            )
          ).status,
          400,
        );
      }
      for (const invalid of [-1, 1.5, "", null, true])
        assert.equal((await request("/api/portal/businesses/impact-vibes", admin, "PATCH", {
          limits: { card: 2, branch: 2, department: invalid, account: 1 },
        })).status, 400);
      assert.equal(
        (await request("/api/cards", owner, "POST", draft)).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/api/portal/businesses/impact-vibes/branches",
            owner,
            "POST",
            { name: "Over limit" },
          )
        ).status,
        403,
      );
      const departmentBlocked = await request(
        "/api/portal/businesses/impact-vibes/departments/branches", admin, "POST",
        { departments: [{ name: "Over department limit", branches: [{ name: "Blocked department branch" }] }] },
      );
      assert.equal(departmentBlocked.status, 403);
      assert.match(departmentBlocked.message, /department limit reached \(1\)/i);
      assert.equal(
        (
          await request("/api/portal/users", owner, "POST", {
            name: "Over limit",
            email: "over@example.test",
            password: "Over-Limit-Password",
            role: "editor",
          })
        ).status,
        403,
      );
      const config = (await request("/api/portal/settings", admin)).settings;
      assert.equal(
        (
          await request("/api/portal/settings", admin, "PUT", {
            ...config,
            cardCreation: false,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/api/cards", admin, "POST", {
            ...draft,
            businessId: otherId,
          })
        ).status,
        403,
      );
      await request("/api/portal/settings", admin, "PUT", config);
      assert.equal(
        (
          await request("/api/portal/businesses/impact-vibes", admin, "PATCH", {
            status: "paused",
          })
        ).status,
        200,
      );
      assert.equal((await request("/api/portal/cards", owner)).status, 403);
      await request("/api/portal/businesses/impact-vibes", admin, "PATCH", {
        status: "active",
      });
    },
  );
  await t.test(
    "the account allowance includes the owner and businesses have independent limits",
    async () => {
      const extraAccount = {
        businessId: otherId,
        name: "Another business login",
        email: "extra@example.test",
        password: "Extra-Test-Password",
        role: "editor",
      };
      assert.equal(
        (await request("/api/portal/users", admin, "POST", extraAccount))
          .status,
        403,
      );
      assert.equal(
        (
          await request(`/api/portal/businesses/${otherId}`, admin, "PATCH", {
            limits: { card: 1, branch: 2, department: 2, account: 2 },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/api/portal/users", admin, "POST", extraAccount))
          .status,
        201,
      );
      assert.equal(
        (
          await request("/api/cards", admin, "POST", {
            ...draft,
            businessId: otherId,
          })
        ).status,
        201,
      );
      const allBranchCard = (await request(`/api/portal/cards?business=${otherId}`, admin)).cards
        .find((card) => card.businessId === otherId);
      assert.equal(allBranchCard.branchName, "All branches");
      assert.equal(allBranchCard.language, "en");
      assert.equal((await request(`/api/cards/${allBranchCard.slug}`)).branchName, "All branches");
      assert.equal(
        (
          await request("/api/cards", admin, "POST", {
            ...draft,
            businessId: otherId,
          })
        ).status,
        403,
      );
      for (const name of ["First branch", "Second branch"])
        assert.equal(
          (
            await request(
              `/api/portal/businesses/${otherId}/branches`,
              admin,
              "POST",
              { name },
            )
          ).status,
          201,
        );
      assert.equal(
        (
          await request(
            `/api/portal/businesses/${otherId}/branches`,
            admin,
            "POST",
            { name: "Third branch" },
          )
        ).status,
        403,
      );
      const disk = JSON.parse(
        await fs.readFile(
          path.join(temporary, "server/data/businesses.json"),
          "utf8",
        ),
      );
      assert.deepEqual(
        disk.find((item) => item.businessId === otherId).limits,
        { card: 1, branch: 2, department: 2, account: 2 },
      );
    },
  );
  await t.test("business deletion disables the entire tenant and retains recovery records", async () => {
    const created = await request("/api/portal/businesses", admin, "POST", {
      name: "Delete Test", loginEmail: "delete@example.test", password: "Delete-Test-Password",
      limits: { card: 10, branch: 2, account: 2 },
    });
    assert.equal(created.status, 201);
    const id = created.business.businessId;
    const account = await request("/api/portal/users", admin, "POST", {
      businessId: id, name: "Delete Editor", email: "delete-editor@example.test", password: "Editor-Test-Password", role: "editor",
    });
    assert.equal(account.status, 201);
    const ownerToken = await login("delete@example.test", "Delete-Test-Password");
    const editorToken = await login("delete-editor@example.test", "Editor-Test-Password");
    const branch = await request(`/api/portal/businesses/${id}/branches`, ownerToken, "POST", { name: "Delete Branch" });
    assert.equal(branch.status, 201);
    const card = await request("/api/cards", ownerToken, "POST", { ...draft, businessId: id, branchId: branch.branch.branchId });
    assert.equal(card.status, 201);
    assert.equal((await request(`/api/cards/${card.slug}`)).status, 200);
    // Expired WhatsApp links must still lead to the existing expired-card UI,
    // not a generic "Card not found" page. Only this isolated fixture is edited.
    const expiryCardsPath = path.join(temporary, "server/data/cards.json");
    const expiryCards = JSON.parse(await fs.readFile(expiryCardsPath, "utf8"));
    const expiring = expiryCards.find((item) => item.slug === card.slug);
    const originalExpiry = expiring.expiresAt;
    expiring.expiresAt = "2000-01-01T00:00:00.000Z";
    await fs.writeFile(expiryCardsPath, JSON.stringify(expiryCards));
    const expiredShare = await fetch(`${base}/share/${card.slug}?v=5`);
    assert.equal(expiredShare.status, 200);
    assert.match(await expiredShare.text(), new RegExp(`/card/${card.slug}`));
    assert.equal((await request(`/api/cards/${card.slug}`)).expired, true);
    expiring.expiresAt = originalExpiry;
    await fs.writeFile(expiryCardsPath, JSON.stringify(expiryCards));
    assert.equal((await request(`/api/portal/businesses/${id}`, ownerToken, "DELETE", { confirmName: "Delete Test" })).status, 403);
    assert.equal((await request(`/api/portal/businesses/${id}`, admin, "DELETE", { confirmName: "wrong" })).status, 400);
    assert.equal((await request(`/api/cards/${card.slug}`)).status, 200);
    const removed = await request(`/api/portal/businesses/${id}`, admin, "DELETE", { confirmName: "Delete Test" });
    assert.equal(removed.status, 200);
    assert.equal(removed.archived, true);
    assert.ok(!(await request("/api/portal/businesses", admin)).businesses.some((business) => business.businessId === id));
    assert.ok(!(await request("/api/portal/cards", admin)).cards.some((item) => item.businessId === id));
    assert.ok(!(await request("/api/portal/users", admin)).users.some((item) => item.businessId === id));
    assert.ok(!(await request("/api/admin/coupons", admin)).coupons.some((item) => item.businessId === id));
    assert.equal((await request(`/api/cards/${card.slug}`)).status, 404);
    const missingBusiness = await request(`/api/cards/${card.slug}`);
    assert.equal(missingBusiness.code, "BUSINESS_UNAVAILABLE");
    const shareFailure = await fetch(`${base}/share/${card.slug}?v=5`);
    assert.equal(shareFailure.status, 404);
    assert.match(shareFailure.headers.get("content-type"), /text\/html/);
    assert.match(shareFailure.headers.get("cache-control"), /no-store/);
    const failureHtml = await shareFailure.text();
    assert.match(failureHtml, /This coupon is no longer available/);
    assert.doesNotMatch(failureHtml, /Business not found\.|window.location.replace|couponCode/);
    for (const url of ["/share", "/share/bad", "/share/invalid/extra"]) {
      const invalid = await fetch(`${base}${url}`);
      assert.equal(invalid.status, 404);
      assert.match(await invalid.text(), /We couldn’t find this coupon/);
    }
    assert.equal((await request(`/api/cards/${card.slug}/claim`, null, "POST", {})).status, 404);
    assert.equal((await request("/api/auth/me", ownerToken)).status, 401);
    assert.equal((await request("/api/auth/me", editorToken)).status, 401);
    assert.equal((await request("/api/cards", admin, "POST", { ...draft, businessId: id })).status, 404);
    assert.equal((await request(`/api/portal/businesses/${id}`, admin, "PATCH", { status: "active" })).status, 404);
    assert.equal((await request(`/api/portal/businesses/${id}`, admin, "DELETE", { confirmName: "Delete Test" })).status, 404);
    const records = JSON.parse(await fs.readFile(businessesPath, "utf8"));
    const archived = records.find((business) => business.businessId === id);
    assert.equal(archived.status, "deleted");
    assert.ok(archived.deletedAt);
    assert.equal(archived.branches[0].name, "Delete Branch");
    assert.ok((await request("/api/portal/businesses", admin)).businesses.some((business) => business.businessId === "impact-vibes"));
    assert.equal((await request("/api/portal/cards", owner)).status, 200);
    assert.ok((await request("/api/portal/audit", admin)).events.some((event) => event.action === "Business deleted" && event.businessId === id));
  });
  await t.test("business administrators create branch staff with mandatory manual login IDs", async () => {
    const created = await request("/api/portal/businesses", admin, "POST", {
      name: "Branch Staff Test", loginId: "BRANCH58", password: "Branch-Owner-Password",
      generateCredentials: true, limits: { card: 10, branch: 2, department: 2, account: 3 },
    });
    assert.equal(created.status, 201);
    const id = created.business.businessId;
    const ownerToken = await login("BRANCH58", "Branch-Owner-Password");
    const firstBranch = await request(`/api/portal/businesses/${id}/branches`, ownerToken, "POST", { name: "North Branch" });
    const secondBranch = await request(`/api/portal/businesses/${id}/branches`, ownerToken, "POST", { name: "South Branch" });
    assert.equal(firstBranch.status, 201);
    assert.equal(secondBranch.status, 201);
    const northCard = await request("/api/cards", ownerToken, "POST", { ...draft, businessId: id, branchId: firstBranch.branch.branchId, couponCode: "NORTH-ONE" });
    const southCard = await request("/api/cards", ownerToken, "POST", { ...draft, businessId: id, branchId: secondBranch.branch.branchId, couponCode: "SOUTH-ONE" });
    assert.equal(northCard.status, 201);
    assert.equal(southCard.status, 201);
    const staffPayload = {
      businessId: id, branchId: firstBranch.branch.branchId, name: "North Staff",
      role: "branch-staff", loginId: "NORTHSTAFF58",
      password: "North-Staff-Password", generateCredentials: true,
    };
    assert.equal((await request("/api/portal/users", ownerToken, "POST", { ...staffPayload, loginId: "" })).status, 400);
    assert.equal((await request("/api/portal/users", admin, "POST", { ...staffPayload, branchId: "missing" })).status, 400);
    const staff = await request("/api/portal/users", ownerToken, "POST", staffPayload);
    assert.equal(staff.status, 201);
    assert.equal(staff.credentials.loginId, "NORTHSTAFF58");
    assert.equal(staff.user.branchId, firstBranch.branch.branchId);
    assert.equal((await request("/api/portal/users", admin, "POST", {
      businessId: id, branchId: secondBranch.branch.branchId, name: "Missing Login Staff",
      role: "branch-staff", password: "South-Staff-Password", generateCredentials: true,
    })).status, 400);
    const automaticStaff = await request("/api/portal/users", admin, "POST", {
      businessId: id, branchId: secondBranch.branch.branchId, name: "South Staff",
      role: "branch-staff", loginId: "SOUTHSTAFF58",
      password: "South-Staff-Password", generateCredentials: true,
    });
    assert.equal(automaticStaff.status, 201);
    assert.equal(automaticStaff.credentials.loginId, "SOUTHSTAFF58");
    const staffToken = await login(staff.credentials.loginId, "North-Staff-Password");
    const southStaffToken = await login(automaticStaff.credentials.loginId, "South-Staff-Password");
    const staffCards = (await request("/api/portal/cards", staffToken)).cards;
    assert.deepEqual(staffCards, []);
    const staffBusiness = (await request("/api/portal/businesses", staffToken)).businesses[0];
    assert.deepEqual(staffBusiness.branches.map((branch) => branch.branchId), [firstBranch.branch.branchId]);
    assert.equal((await request("/api/cards", staffToken, "POST", { ...draft, businessId: id, branchId: firstBranch.branch.branchId })).status, 403);
    assert.equal((await request("/api/portal/users", staffToken)).status, 403);
    assert.equal((await request("/api/portal/redeem", staffToken, "POST", { couponCode: "NORTH-ONE" })).status, 409);
    assert.equal((await request(`/api/cards/${northCard.slug}/claim`, null, "POST", {})).status, 200);
    assert.deepEqual((await request("/api/portal/cards", staffToken)).cards, []);
    const fulfilled = await request("/api/portal/redeem", staffToken, "POST", { couponCode: "north-one" });
    assert.equal(fulfilled.status, 200);
    assert.equal(fulfilled.coupon.couponCode, "NORTH-ONE");
    assert.equal(fulfilled.coupon.staffName, "North Staff");
    assert.equal(fulfilled.coupon.redemptionStatus, "Redeemed");
    assert.equal(fulfilled.coupon.assignedBranchName, "North Branch");
    assert.equal(fulfilled.coupon.redeemedBranchName, "North Branch");
    assert.ok(fulfilled.coupon.redeemedAt);
    const redeemedPublicCard = await request(`/api/cards/${northCard.slug}`);
    assert.equal(redeemedPublicCard.redeemed, true);
    assert.equal(redeemedPublicCard.couponCode, undefined);
    const repeated = await request("/api/portal/redeem", staffToken, "POST", { couponCode: "NORTH-ONE" });
    assert.equal(repeated.status, 409);
    assert.equal(repeated.details.couponCode, "NORTH-ONE");
    assert.equal(repeated.details.redemptionStatus, "Redeemed");
    assert.equal(repeated.details.assignedBranchName, "North Branch");
    assert.equal(repeated.details.redeemedBranchName, "North Branch");
    assert.equal(repeated.details.staffName, "North Staff");
    assert.ok(repeated.details.redeemedAt);
    const wrongUnredeemed = await request("/api/portal/redeem", staffToken, "POST", { couponCode: "SOUTH-ONE" });
    assert.equal(wrongUnredeemed.status, 403);
    assert.equal(wrongUnredeemed.details.redemptionStatus, "Not redeemed");
    assert.equal(wrongUnredeemed.details.assignedBranchName, "South Branch");
    assert.equal(wrongUnredeemed.details.staffName, undefined);
    assert.equal((await request(`/api/cards/${southCard.slug}/claim`, null, "POST", {})).status, 200);
    const competingBranches = await Promise.all([
      request("/api/portal/redeem", staffToken, "POST", { couponCode: "SOUTH-ONE" }),
      request("/api/portal/redeem", southStaffToken, "POST", { couponCode: "SOUTH-ONE" }),
    ]);
    assert.equal(competingBranches.filter((result) => result.status === 200).length, 1);
    assert.equal(competingBranches.filter((result) => result.status === 403).length, 1);
    assert.match(competingBranches.find((result) => result.status === 403).message, /another branch/i);
    const lockedSouthCard = (await request("/api/portal/cards", ownerToken)).cards.find((card) => card.slug === southCard.slug);
    assert.ok(lockedSouthCard.staffRedeemedAt);
    assert.equal(lockedSouthCard.staffRedeemedBranchId, secondBranch.branch.branchId);
    // Legacy deployments could save the staff/branch fields from the viewer who
    // checked an already-redeemed code. The immutable assignment and redemption
    // audit must repair the displayed details instead of repeating that bad data.
    const cardsPath = path.join(temporary, "server/data/cards.json");
    const persistedCards = JSON.parse(await fs.readFile(cardsPath, "utf8"));
    const persistedSouthCard = persistedCards.find((card) => card.slug === southCard.slug);
    persistedSouthCard.staffRedeemedBranchId = firstBranch.branch.branchId;
    persistedSouthCard.staffRedeemedBy = staff.user.id;
    persistedSouthCard.staffRedeemedByName = "North Staff";
    persistedSouthCard.staffRedeemedAt = "2000-01-01T00:00:00.000Z";
    await fs.writeFile(cardsPath, JSON.stringify(persistedCards));
    const wrongRedeemed = await request("/api/portal/redeem", staffToken, "POST", { couponCode: "SOUTH-ONE" });
    assert.equal(wrongRedeemed.status, 403);
    assert.equal(wrongRedeemed.details.redemptionStatus, "Redeemed");
    assert.equal(wrongRedeemed.details.assignedBranchName, "South Branch");
    assert.equal(wrongRedeemed.details.redeemedBranchName, "South Branch");
    assert.equal(wrongRedeemed.details.staffName, "South Staff");
    assert.ok(wrongRedeemed.details.redeemedAt);
    assert.notEqual(new Date(wrongRedeemed.details.redeemedAt).getUTCFullYear(), 2000);
    const listedSouthCard = (await request(`/api/portal/cards?business=${id}`, admin)).cards.find(item => item.slug === southCard.slug);
    assert.equal(listedSouthCard.redemptionDetails.staffName, "South Staff");
    assert.equal(listedSouthCard.redemptionDetails.departmentName, "South Branch");
    assert.equal(new Date(listedSouthCard.redemptionDetails.redeemedAt).getTime(), new Date(wrongRedeemed.details.redeemedAt).getTime());
    assert.equal((await request("/api/portal/redeem", ownerToken, "POST", { couponCode: "NORTH-ONE" })).status, 403);
    let monitored = (await request("/api/portal/users", admin)).users.find((user) => user.id === staff.user.id);
    assert.equal(monitored.loginCount, 1);
    assert.ok(monitored.lastLoginAt);
    assert.equal((await request(`/api/portal/users/${staff.user.id}`, ownerToken, "PATCH", { branchId: secondBranch.branch.branchId })).status, 200);
    assert.equal((await request("/api/auth/me", staffToken)).status, 401);
    const reassignedToken = await login(staff.credentials.loginId, "North-Staff-Password");
    assert.deepEqual((await request("/api/portal/cards", reassignedToken)).cards.map((card) => card.slug), [southCard.slug]);
    assert.equal((await request("/api/portal/redeem", reassignedToken, "POST", { couponCode: "SOUTH-ONE" })).status, 409);
    monitored = (await request("/api/portal/users", admin)).users.find((user) => user.id === staff.user.id);
    assert.equal(monitored.loginCount, 2);
    const deletePath = `/api/portal/users/${staff.user.id}`;
    const confirmation = { confirmName: "North Staff" };
    const beforeDeletion = (await request("/api/portal/cards", ownerToken)).cards;
    assert.equal((await request(deletePath, null, "DELETE", confirmation)).status, 401);
    assert.equal((await request(deletePath, reassignedToken, "DELETE", confirmation)).status, 403);
    assert.equal((await request(deletePath, owner, "DELETE", confirmation)).status, 404);
    assert.equal((await request(`${deletePath}?business=impact-vibes`, ownerToken, "DELETE", confirmation)).status, 403);
    assert.equal((await request(deletePath, ownerToken, "DELETE", {})).status, 400);
    assert.equal((await request(deletePath, ownerToken, "DELETE", { confirmName: "Wrong staff" })).status, 400);
    assert.ok((await request("/api/portal/users", ownerToken)).users.some((item) => item.id === staff.user.id));
    const deleted = await request(deletePath, ownerToken, "DELETE", confirmation);
    assert.equal(deleted.status, 200, deleted.message);
    assert.equal(deleted.archived, true);
    assert.equal((await request("/api/auth/me", reassignedToken)).status, 401);
    assert.equal((await request("/api/auth/login", null, "POST", {
      loginId: "NORTHSTAFF58", password: "North-Staff-Password",
    })).status, 401);
    for (const token of [ownerToken, admin])
      assert.ok(!(await request("/api/portal/users", token)).users.some((item) => item.id === staff.user.id));
    assert.equal((await request(deletePath, ownerToken, "DELETE", confirmation)).status, 404);
    assert.equal((await request(deletePath, ownerToken, "PATCH", { status: "active" })).status, 404);
    assert.equal((await request(`/api/portal/users/${viewerId}`, admin, "DELETE", { confirmName: "Viewer" })).status, 404);
    assert.deepEqual((await request("/api/portal/cards", ownerToken)).cards, beforeDeletion);
    const stillRedeemed = await request("/api/portal/redeem", southStaffToken, "POST", { couponCode: "NORTH-ONE" });
    assert.equal(stillRedeemed.details.staffName, "North Staff");
    const deletedByAdmin = await request(`/api/portal/users/${automaticStaff.user.id}`, admin, "DELETE", { confirmName: "South Staff" });
    assert.equal(deletedByAdmin.status, 200);
    assert.equal((await request("/api/auth/me", southStaffToken)).status, 401);
    // The archived identity stays intact, but its login ID is reusable within
    // the same business. A new account must never revive the old sessions.
    assert.equal((await request("/api/portal/users", ownerToken, "POST", { ...staffPayload, role: "editor" })).status, 409);
    const replacement = await request("/api/portal/users", ownerToken, "POST", {
      ...staffPayload, name: "Replacement staff", loginId: "northstaff58", password: "Replacement-Staff-Password",
    });
    assert.equal(replacement.status, 201, replacement.message);
    assert.notEqual(replacement.user.id, staff.user.id);
    assert.equal((await request("/api/auth/me", reassignedToken)).status, 401);
    assert.equal((await request("/api/auth/login", null, "POST", {
      loginId: "NORTHSTAFF58", password: "North-Staff-Password",
    })).status, 401);
    const replacementToken = await login("NORTHSTAFF58", "Replacement-Staff-Password");
    assert.equal((await request("/api/auth/me", replacementToken)).user.id, replacement.user.id);
    assert.equal((await request("/api/portal/users", ownerToken, "POST", staffPayload)).status, 409);
    assert.equal((await request(`/api/portal/users/${replacement.user.id}`, ownerToken, "PATCH", { status: "paused" })).status, 200);
    assert.equal((await request("/api/portal/users", ownerToken, "POST", staffPayload)).status, 409);
    assert.deepEqual((await request("/api/portal/cards", ownerToken)).cards, beforeDeletion);
    assert.equal((await request(`/api/portal/users/${replacement.user.id}`, ownerToken, "DELETE", { confirmName: "Replacement staff" })).status, 200);
    // Several concurrent requests for an archived ID can create only one user.
    const recreated = await Promise.all(Array.from({ length: 5 }, (_, index) => request("/api/portal/users", ownerToken, "POST", {
      ...staffPayload, name: `Recreated staff ${index}`, password: "Recreated-Staff-Password",
    })));
    assert.equal(recreated.filter(result => result.status === 201).length, 1);
    assert.equal(recreated.filter(result => result.status === 409).length, 4);
    const recreatedUser = recreated.find(result => result.status === 201).user;
    assert.notEqual(recreatedUser.id, staff.user.id);
    assert.notEqual(recreatedUser.id, replacement.user.id);
    assert.equal((await request("/api/auth/me", replacementToken)).status, 401);
    assert.deepEqual((await request("/api/portal/cards", ownerToken)).cards, beforeDeletion);
    const savedMeta = JSON.parse(await fs.readFile(path.join(temporary, "server/data/control.json"), "utf8"));
    const archived = savedMeta.users.find((item) => item.id === staff.user.id);
    assert.equal(archived.status, "deleted");
    assert.ok(archived.deletedAt);
    assert.equal(archived.deletedBy, id);
    assert.equal(savedMeta.users.filter(item => item.status !== "deleted"
      && String(item.loginId || "").toLowerCase() === "northstaff58").length, 1);
    assert.ok(savedMeta.audit.some((event) => event.action === "Staff account deleted" && event.businessId === id));
    assert.equal((await request(`/api/portal/businesses/${id}`, admin, "DELETE", { confirmName: "Branch Staff Test" })).status, 200);
  });
  await t.test("same departments redeem across locations exactly once and preserve the actual redemption record", async () => {
    const created = await request("/api/portal/businesses", admin, "POST", {
      name: "Cross-location sales", password: "Cross-Location-Password",
      limits: { card: 0, branch: 0, department: 0, account: 0 },
    });
    assert.equal(created.status, 201, created.message);
    const businessId = created.business.businessId;
    const hierarchy = await request(`/api/portal/businesses/${businessId}/departments/branches`, admin, "POST", {
      departments: [
        { name: "Ameerpet", branches: [{ name: "Sales" }, { name: "Service" }] },
        { name: "Punjagutta", branches: [{ name: " sales " }] },
      ],
    });
    assert.equal(hierarchy.status, 201, hierarchy.message);
    const [sourceSales, service, destinationSales] = hierarchy.branches;
    const makeStaff = async (branch, name, loginId, id = businessId) => {
      const staff = await request("/api/portal/users", admin, "POST", {
        businessId: id, branchId: branch.branchId, role: "branch-staff", name, loginId,
        password: "Cross-Staff-Password", generateCredentials: true,
      });
      assert.equal(staff.status, 201, staff.message);
      return { ...staff, token: await login(loginId, "Cross-Staff-Password") };
    };
    const sourceStaff = await makeStaff(sourceSales, "Ameerpet staff", "AMEERSALES88");
    const destinationStaff = await makeStaff(destinationSales, "Punjagutta staff", "PUNJSALES88");
    const serviceStaff = await makeStaff(service, "Service staff", "SERVICESTAFF88");
    const makeCoupon = async (couponCode, assignedBranchId = sourceSales.branchId) => {
      const card = await request("/api/cards", admin, "POST", { ...draft, businessId, branchId: assignedBranchId, couponCode });
      assert.equal(card.status, 201, card.message);
      return card;
    };
    const redeem = (staff, code) => request("/api/portal/redeem", staff.token, "POST", { couponCode: code });
    const card = await makeCoupon("CROSS-SALES-ONE");
    assert.equal((await redeem(destinationStaff, card.couponCode)).status, 409);
    assert.equal((await request(`/api/cards/${card.slug}/claim`, null, "POST", {})).status, 200);
    assert.equal((await redeem(serviceStaff, card.couponCode)).status, 403);
    const success = await redeem(destinationStaff, card.couponCode);
    assert.equal(success.status, 200, success.message);
    assert.equal(success.coupon.assignedBranchName, "Sales");
    assert.equal(success.coupon.assignedLocationName, "Ameerpet");
    assert.equal(success.coupon.redeemedLocationName, "Punjagutta");
    assert.equal(success.coupon.staffName, "Punjagutta staff");
    assert.ok(Date.now() - new Date(success.coupon.redeemedAt).getTime() < 10000);
    const savedCards = (await request(`/api/portal/cards?business=${businessId}`, admin)).cards;
    const saved = savedCards.find((item) => item.slug === card.slug);
    assert.equal(saved.branchId, sourceSales.branchId);
    assert.equal(saved.staffRedeemedBranchId, destinationSales.branchId);
    assert.equal(saved.staffRedeemedDepartmentId, destinationSales.departmentId);
    assert.equal(saved.staffRedeemedBy, destinationStaff.user.id);
    assert.equal(saved.staffRedeemedByName, "Punjagutta staff");
    assert.equal(saved.staffRedeemedLocationName, "Punjagutta");
    assert.deepEqual(saved.redemptionDetails, {
      staffId: destinationStaff.user.id,
      staffName: "Punjagutta staff", branchName: "Punjagutta", departmentName: destinationSales.name,
      redeemedAt: success.coupon.redeemedAt,
    });
    assert.equal(saved.status, "redeemed");
    assert.ok((await request("/api/portal/cards", destinationStaff.token)).cards.some((item) => item.slug === card.slug));
    for (const staff of [sourceStaff, destinationStaff]) {
      const repeat = await redeem(staff, card.couponCode);
      assert.equal(repeat.status, 409);
      assert.equal(repeat.details.assignedLocationName, "Ameerpet");
      assert.equal(repeat.details.redeemedLocationName, "Punjagutta");
      assert.equal(repeat.details.staffName, "Punjagutta staff");
      assert.equal(new Date(repeat.details.redeemedAt).getTime(), new Date(saved.staffRedeemedAt).getTime());
    }
    const wrongDepartment = await redeem(serviceStaff, card.couponCode);
    assert.equal(wrongDepartment.status, 403);
    assert.equal(wrongDepartment.details.redeemedLocationName, "Punjagutta");
    assert.equal(wrongDepartment.details.staffName, "Punjagutta staff");
    const raceCard = await makeCoupon("CROSS-SALES-RACE");
    assert.equal((await request(`/api/cards/${raceCard.slug}/claim`, null, "POST", {})).status, 200);
    const race = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      redeem(index % 2 ? sourceStaff : destinationStaff, raceCard.couponCode)));
    assert.equal(race.filter((result) => result.status === 200).length, 1);
    assert.equal(race.filter((result) => result.status === 409).length, 5);
    const winner = race.find((result) => result.status === 200).coupon;
    for (const result of race.filter((item) => item.status === 409)) {
      assert.equal(result.details.staffName, winner.staffName);
      assert.equal(result.details.redeemedLocationName, winner.redeemedLocationName);
    }
    // A reward that expires after scratching, or is disabled, cannot be consumed.
    const expired = await makeCoupon("CROSS-SALES-EXPIRED");
    const disabled = await makeCoupon("CROSS-SALES-DISABLED");
    for (const item of [expired, disabled])
      assert.equal((await request(`/api/cards/${item.slug}/claim`, null, "POST", {})).status, 200);
    const cardsPath = path.join(temporary, "server/data/cards.json");
    const persisted = JSON.parse(await fs.readFile(cardsPath, "utf8"));
    persisted.find((item) => item.slug === expired.slug).expiresAt = new Date(Date.now() - 1000).toISOString();
    persisted.find((item) => item.slug === disabled.slug).disabled = true;
    await fs.writeFile(cardsPath, JSON.stringify(persisted));
    assert.equal((await redeem(destinationStaff, expired.couponCode)).status, 410);
    assert.equal((await redeem(destinationStaff, disabled.couponCode)).status, 410);
    const other = await request("/api/portal/businesses", admin, "POST", {
      name: "Other sales business", password: "Other-Sales-Password", limits: { card: 0, branch: 0, department: 0, account: 0 },
    });
    assert.equal(other.status, 201);
    const otherSales = await request(`/api/portal/businesses/${other.business.businessId}/branches`, admin, "POST", { name: "Sales" });
    assert.equal(otherSales.status, 201);
    const otherStaff = await makeStaff(otherSales.branch, "Other business staff", "OTHERSALES88", other.business.businessId);
    assert.equal((await redeem(otherStaff, card.couponCode)).status, 404);
    // "All departments" uses an empty branchId, not a specific Sales/Service unit.
    // Any active staff in this business may redeem it, but still only once.
    const allStaff = [sourceStaff, destinationStaff, serviceStaff];
    for (const [index, staff] of allStaff.entries()) {
      const universal = await makeCoupon(`ALL-DEPTS-${index}`, "");
      assert.equal((await redeem(staff, universal.couponCode)).status, 409);
      assert.equal((await request(`/api/cards/${universal.slug}/claim`, null, "POST", {})).status, 200);
      assert.equal((await redeem(otherStaff, universal.couponCode)).status, 404);
      const success = await redeem(staff, universal.couponCode);
      assert.equal(success.status, 200, success.message);
      assert.equal(success.coupon.staffName, staff.user.name);
      assert.equal(success.coupon.assignedBranchName, "All branches");
      for (const checkingStaff of allStaff) {
        const repeated = await redeem(checkingStaff, universal.couponCode);
        assert.equal(repeated.status, 409);
        assert.equal(repeated.details.staffName, staff.user.name);
        assert.equal(repeated.details.redeemedBranchName, success.coupon.redeemedBranchName);
        assert.equal(repeated.details.redeemedLocationName, success.coupon.redeemedLocationName);
        assert.equal(new Date(repeated.details.redeemedAt).getTime(), new Date(success.coupon.redeemedAt).getTime());
      }
    }
    const universalRace = await makeCoupon("ALL-DEPTS-RACE", "");
    assert.equal((await request(`/api/cards/${universalRace.slug}/claim`, null, "POST", {})).status, 200);
    const universalResults = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      redeem(allStaff[index % allStaff.length], universalRace.couponCode)));
    assert.equal(universalResults.filter(result => result.status === 200).length, 1);
    assert.equal(universalResults.filter(result => result.status === 409).length, 5);
    const universalExpired = await makeCoupon("ALL-DEPTS-EXPIRED", "");
    const universalDisabled = await makeCoupon("ALL-DEPTS-DISABLED", "");
    const legacyNull = await makeCoupon("ALL-DEPTS-NULL", "");
    const legacyMissing = await makeCoupon("ALL-DEPTS-MISSING", "");
    for (const item of [universalExpired, universalDisabled, legacyNull, legacyMissing])
      assert.equal((await request(`/api/cards/${item.slug}/claim`, null, "POST", {})).status, 200);
    const universalPersisted = JSON.parse(await fs.readFile(cardsPath, "utf8"));
    universalPersisted.find(item => item.slug === universalExpired.slug).expiresAt = new Date(Date.now() - 1000).toISOString();
    universalPersisted.find(item => item.slug === universalDisabled.slug).disabled = true;
    universalPersisted.find(item => item.slug === legacyNull.slug).branchId = null;
    delete universalPersisted.find(item => item.slug === legacyMissing.slug).branchId;
    await fs.writeFile(cardsPath, JSON.stringify(universalPersisted));
    for (const staff of allStaff) {
      assert.equal((await redeem(staff, universalExpired.couponCode)).status, 410);
      assert.equal((await redeem(staff, universalDisabled.couponCode)).status, 410);
    }
    assert.equal((await redeem(serviceStaff, legacyNull.couponCode)).status, 200);
    assert.equal((await redeem(destinationStaff, legacyMissing.couponCode)).status, 200);
    const finalCards = (await request(`/api/portal/cards?business=${businessId}`, admin)).cards;
    assert.deepEqual(finalCards.find((item) => item.slug === card.slug), saved);
    for (const item of [expired, disabled])
      assert.equal(finalCards.find((row) => row.slug === item.slug).staffRedeemedAt, null);
    for (const tenant of [created.business, other.business])
      assert.equal((await request(`/api/portal/businesses/${tenant.businessId}`, admin, "DELETE", { confirmName: tenant.name })).status, 200);
  });
  await t.test("only super admins can permanently delete every coupon for one business", async () => {
    const created = await request("/api/portal/businesses", admin, "POST", {
      name: "Coupon Delete Test", loginEmail: "coupon-delete@example.test", password: "Coupon-Delete-Test-Password",
      limits: { card: 10, branch: 2, department: 2, account: 1 },
    });
    assert.equal(created.status, 201);
    const id = created.business.businessId;
    const ownerToken = await login("coupon-delete@example.test", "Coupon-Delete-Test-Password");
    const first = await request("/api/cards", ownerToken, "POST", { ...draft, businessId: id, couponCode: "DELETE-ONE" });
    const second = await request("/api/cards", ownerToken, "POST", { ...draft, businessId: id, couponCode: "DELETE-TWO" });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal((await request(`/api/portal/businesses/${id}/cards/${first.slug}`, ownerToken, "DELETE", { confirmCode: "DELETE-ONE" })).status, 403);
    assert.equal((await request(`/api/portal/businesses/${id}/cards/${first.slug}`, admin, "DELETE", { confirmCode: "wrong" })).status, 400);
    const removedOne = await request(`/api/portal/businesses/${id}/cards/${first.slug}`, admin, "DELETE", { confirmCode: "delete-one" });
    assert.equal(removedOne.status, 200);
    assert.equal(removedOne.deletedCount, 1);
    assert.equal((await request(`/api/cards/${first.slug}`)).status, 404);
    assert.equal((await request(`/api/cards/${second.slug}`)).status, 200);
    assert.equal((await request(`/api/portal/businesses/${id}/cards`, ownerToken, "DELETE", { confirmName: "Coupon Delete Test" })).status, 403);
    assert.equal((await request(`/api/portal/businesses/${id}/cards`, admin, "DELETE", { confirmName: "wrong" })).status, 400);
    const removed = await request(`/api/portal/businesses/${id}/cards`, admin, "DELETE", { confirmName: "Coupon Delete Test" });
    assert.equal(removed.status, 200);
    assert.equal(removed.deletedCount, 1);
    assert.equal((await request(`/api/cards/${first.slug}`)).status, 404);
    assert.equal((await request(`/api/cards/${second.slug}`)).status, 404);
    assert.equal((await request("/api/portal/cards", ownerToken)).cards.length, 0);
    assert.ok((await request("/api/portal/businesses", admin)).businesses.some((business) => business.businessId === id));
    assert.ok((await request("/api/portal/audit", admin)).events.some((event) => event.action === "All business coupons deleted" && event.businessId === id));
    assert.ok((await request("/api/portal/audit", admin)).events.some((event) => event.action === "Business coupon deleted" && event.businessId === id));
    assert.equal((await request(`/api/portal/businesses/${id}`, admin, "DELETE", { confirmName: "Coupon Delete Test" })).status, 200);
  });
  await t.test(
    "branding, audit history, revocation, and password changes persist",
    async () => {
      assert.equal(
        (
          await request("/api/portal/businesses/impact-vibes", owner, "PATCH", {
            website: "https://example.test",
            brand: {
              pageColor: "#001122",
              textColor: "#ffffff",
              accentColor: "#ffbb44",
            },
          })
        ).status,
        200,
      );
      const business = (await request("/api/portal/businesses", owner))
        .businesses[0];
      assert.equal(business.name, "Impact Vibes");
      assert.equal(business.brand.pageColor, "#001122");
      const events = (await request("/api/portal/audit", owner)).events;
      assert.ok(events.length > 5);
      assert.ok(events.every((item) => item.businessId === "impact-vibes"));
      assert.equal(
        (await request("/api/portal/security/revoke", owner, "POST", {}))
          .status,
        200,
      );
      assert.equal((await request("/api/portal/cards", editor)).status, 401);
      assert.equal((await request("/api/portal/cards", owner)).status, 200);
      assert.equal(
        (
          await request("/api/portal/security/password", admin, "POST", {
            currentPassword: "Platform-Test-Password",
            password: "Changed-Platform-Password",
          })
        ).status,
        200,
      );
      assert.equal((await request("/api/portal/settings", admin)).status, 401);
      assert.equal(
        (
          await request("/api/auth/login", null, "POST", {
            email: "platform@example.test",
            password: "",
          })
        ).status,
        401,
      );
      const fresh = await login(
        "platform@example.test",
        "Changed-Platform-Password",
      );
      assert.equal(
        (await request("/api/auth/logout", fresh, "POST", {})).status,
        200,
      );
      assert.equal((await request("/api/auth/me", fresh)).status, 401);
      const stored = JSON.parse(
        await fs.readFile(
          path.join(temporary, "server/data/control.json"),
          "utf8",
        ),
      );
      assert.ok(stored.adminPasswordHash);
      assert.ok(stored.audit.length > events.length);
    },
  );
  await t.test("manual account passwords and generated login IDs are scoped and never stored in plaintext", async () => {
    const fresh = await login("platform@example.test", "Changed-Platform-Password");
    const loginById = async (credentials) => {
      const result = await request("/api/auth/login", null, "POST", credentials);
      assert.equal(result.status, 200, result.message);
      assert.equal(result.user.passwordHash, undefined);
      assert.equal(result.user.password, undefined);
      assert.equal(result.credentials, undefined);
      return result;
    };
    assert.equal((await request("/api/portal/super-admins", owner)).status, 403);
    assert.equal((await request("/api/portal/super-admins", owner, "POST", { name: "Forbidden admin" })).status, 403);
    assert.equal((await request("/api/portal/super-admins", null, "POST", { name: "Anonymous admin" })).status, 401);
    assert.equal((await request("/api/portal/businesses", fresh, "POST", { name: "Generated Test", limits: { card: "", branch: 2, account: 2 } })).status, 400);
    assert.equal((await request("/api/portal/businesses", fresh, "POST", {
      name: "Generated Test", password: "", limits: { card: 20, branch: 2, account: 2 },
    })).status, 400);
    for (const loginId of ["ABC12", "ABCDEFGHIJKLMNOPQ1", "ONLYLETTERS", "12345678", "bad-id1"]) {
      const invalid = await request("/api/portal/businesses", fresh, "POST", {
        name: "Invalid Login ID Test",
        loginId,
        password: "manual password!",
        limits: { card: 20, branch: 2, department: 2, account: 1 },
        generateCredentials: true,
      });
      assert.equal(invalid.status, 400);
    }
    const customPassword = "custom password!";
    const custom = await request("/api/portal/businesses", fresh, "POST", {
      name: "Custom Login ID Test",
      loginId: "CUSTOM58",
      password: customPassword,
      limits: { card: 20, branch: 2, department: 2, account: 1 },
      generateCredentials: true,
    });
    assert.equal(custom.status, 201, custom.message);
    assert.equal(custom.credentials.loginId, "CUSTOM58");
    assert.equal((await request("/api/portal/businesses", fresh, "POST", {
      name: "Duplicate Login ID Test",
      loginId: "custom58",
      password: "another password!",
      limits: { card: 20, branch: 2, department: 2, account: 1 },
      generateCredentials: true,
    })).status, 409);
    const customOwner = await loginById({ loginId: "custom58", password: customPassword });
    assert.equal((await request(
      `/api/portal/businesses/${custom.business.businessId}`,
      customOwner.token,
      "PATCH",
      { loginId: "OWNERTRY9" },
    )).status, 403);
    const renamed = await request(
      `/api/portal/businesses/${custom.business.businessId}`,
      fresh,
      "PATCH",
      { loginId: "NEWLOGIN77" },
    );
    assert.equal(renamed.status, 200, renamed.message);
    assert.equal(
      (await request("/api/portal/businesses", fresh)).businesses
        .find((item) => item.businessId === custom.business.businessId).loginId,
      "NEWLOGIN77",
    );
    assert.equal((await request("/api/auth/me", customOwner.token)).status, 401);
    assert.equal((await request("/api/auth/login", null, "POST", {
      loginId: "custom58", password: customPassword,
    })).status, 401);
    assert.equal((await request("/api/auth/login", null, "POST", {
      loginId: "newlogin77", password: customPassword,
    })).status, 200);
    const automaticallyRenamed = await request(
      `/api/portal/businesses/${custom.business.businessId}`,
      fresh,
      "PATCH",
      { loginId: "" },
    );
    assert.equal(automaticallyRenamed.status, 200, automaticallyRenamed.message);
    const automaticLoginId = (await request("/api/portal/businesses", fresh)).businesses
      .find((item) => item.businessId === custom.business.businessId).loginId;
    assert.match(automaticLoginId, /^(?=.*[A-Z])(?=.*\d)[A-Z\d]{12}$/);
    assert.notEqual(automaticLoginId, "NEWLOGIN77");
    assert.equal((await request("/api/auth/login", null, "POST", {
      loginId: "newlogin77", password: customPassword,
    })).status, 401);
    assert.equal((await request("/api/auth/login", null, "POST", {
      loginId: automaticLoginId, password: customPassword,
    })).status, 200);
    const createdPassword = "anything is ok!";
    const created = await request("/api/portal/businesses", fresh, "POST", {
      name: "Generated Test", password: createdPassword, limits: { card: 20, branch: 2, account: 2 },
    });
    assert.equal(created.status, 201, created.message);
    assert.match(created.credentials.loginId, /^(?=.*[A-Z])(?=.*\d)[A-Z\d]{12}$/);
    assert.equal(created.credentials.password, createdPassword);
    assert.equal(created.business.loginId, created.credentials.loginId);
    assert.equal(created.business.loginEmail, undefined);
    assert.equal(created.business.passwordHash, undefined);
    const businessLogin = await loginById(created.credentials);
    assert.equal(businessLogin.user.role, "business");
    assert.equal((await request("/api/portal/businesses", businessLogin.token)).businesses.length, 1);
    assert.equal((await request("/api/portal/cards?business=impact-vibes", businessLogin.token)).status, 403);
    assert.equal((await request("/api/portal/super-admins", businessLogin.token)).status, 403);
    const member = await request("/api/portal/users", fresh, "POST", {
      businessId: created.business.businessId, name: "Generated editor", role: "editor", password: "editor!",
    });
    assert.equal(member.status, 201, member.message);
    assert.match(member.credentials.loginId, /^(?=.*[A-Z])(?=.*\d)[A-Z\d]{12}$/);
    assert.equal((await loginById(member.credentials)).user.role, "editor");
    const others = await Promise.all([
      ["Generated admin 1", "admin one!"], ["Generated admin 2", "admin two!"],
    ].map(([name, password]) => request("/api/portal/super-admins", fresh, "POST", { name, password })));
    for (const result of others) {
      assert.equal(result.status, 201, result.message);
      assert.match(result.credentials.loginId, /^(?=.*[A-Z])(?=.*\d)[A-Z\d]{12}$/);
      assert.equal(result.user.passwordHash, undefined);
    }
    const all = [created, member, ...others];
    assert.equal(new Set(all.map((item) => item.credentials.loginId)).size, all.length);
    assert.equal(new Set(all.map((item) => item.credentials.password)).size, all.length);
    let secondAdmin = await loginById(others[0].credentials);
    assert.equal(secondAdmin.user.role, "super-admin");
    assert.equal((await request("/api/portal/settings", secondAdmin.token)).status, 200);
    assert.equal((await request("/api/auth/me", secondAdmin.token)).user.loginId, others[0].credentials.loginId);
    const list = await request("/api/portal/super-admins", fresh);
    assert.ok(list.users.some((item) => item.id === "super-admin" && item.primary));
    assert.ok(list.users.every((item) => !item.passwordHash && !item.password && !item.credentials));
    assert.equal((await request("/api/portal/super-admins/super-admin", fresh, "PATCH", { status: "paused" })).status, 400);
    assert.equal((await request(`/api/portal/super-admins/${others[0].user.id}`, secondAdmin.token, "PATCH", { status: "paused" })).status, 400);
    assert.equal((await request(`/api/portal/super-admins/${others[0].user.id}`, fresh, "PATCH", { status: "paused" })).status, 200);
    assert.equal((await request("/api/auth/me", secondAdmin.token)).status, 401);
    assert.equal((await request("/api/auth/login", null, "POST", others[0].credentials)).status, 401);
    assert.equal((await request(`/api/portal/super-admins/${others[0].user.id}`, fresh, "PATCH", { status: "active" })).status, 200);
    secondAdmin = await loginById(others[0].credentials);
    assert.equal((await request("/api/portal/security/password", secondAdmin.token, "POST", { currentPassword: "Wrong password", password: "Changed-Generated-Password" })).status, 400);
    const changedPassword = await request("/api/portal/security/password", secondAdmin.token, "POST", { currentPassword: others[0].credentials.password, password: "Changed-Generated-Password" });
    assert.equal(changedPassword.status, 200);
    assert.ok(changedPassword.token);
    assert.equal(changedPassword.user.password, undefined);
    assert.equal(changedPassword.user.passwordHash, undefined);
    assert.equal((await request("/api/auth/me", changedPassword.token)).status, 200);
    assert.equal((await request("/api/auth/me", secondAdmin.token)).status, 401);
    assert.equal((await request("/api/auth/login", null, "POST", others[0].credentials)).status, 401);
    await loginById({ loginId: others[0].credentials.loginId, password: "Changed-Generated-Password" });
    // Updating a generated admin must not change the original super-admin password.
    await login("platform@example.test", "Changed-Platform-Password");
    const businesses = (await request("/api/portal/businesses", fresh)).businesses;
    const members = (await request(`/api/portal/users?business=${created.business.businessId}`, fresh)).users;
    const storage = `${await fs.readFile(businessesPath, "utf8")} ${await fs.readFile(path.join(temporary, "server/data/control.json"), "utf8")}`;
    const readable = JSON.stringify({ businesses, members, list });
    for (const result of all) {
      assert.ok(!storage.includes(result.credentials.password));
      assert.ok(!readable.includes(result.credentials.password));
    }
    assert.ok(!storage.includes("Changed-Generated-Password"));
    assert.equal((await request(`/api/portal/businesses/${custom.business.businessId}`, fresh, "DELETE", { confirmName: "Custom Login ID Test" })).status, 200);
    assert.equal((await request(`/api/portal/businesses/${created.business.businessId}`, fresh, "DELETE", { confirmName: "Generated Test" })).status, 200);
    assert.equal((await request("/api/auth/me", businessLogin.token)).status, 401);
  });
  await t.test("super admins reset business passwords without exposing secrets and revoke old sessions", async () => {
    const rootToken = await login("platform@example.test", "Changed-Platform-Password");
    for (const legacy of [false, true]) {
      const created = await request("/api/portal/businesses", rootToken, "POST", {
        name: legacy ? "Legacy reset test" : "Generated reset test",
        limits: { card: 10, branch: 1, account: 1 },
        ...(legacy
          ? { loginEmail: "legacy-reset@example.test", password: "Original-Reset-Password" }
          : { password: "RESETORIGIN58" }),
      });
      assert.equal(created.status, 201);
      const id = created.business.businessId;
      const original = created.credentials || { loginId: created.business.loginEmail, password: "Original-Reset-Password" };
      const signedIn = await request("/api/auth/login", null, "POST", original);
      assert.equal(signedIn.status, 200);
      const url = `/api/portal/businesses/${id}`;
      const password = "New-Business-Password!234";
      assert.equal((await request(url, null, "PATCH", { password })).status, 401);
      assert.equal((await request(url, signedIn.token, "PATCH", { password })).status, 403);
      for (const invalid of ["", "short", "x".repeat(201), null, 12345678901, {}])
        assert.equal((await request(url, rootToken, "PATCH", { password: invalid })).status, 400);
      assert.equal((await request("/api/auth/me", signedIn.token)).status, 200);
      const reset = await request(url, rootToken, "PATCH", { password });
      assert.equal(reset.status, 200);
      assert.ok(!JSON.stringify(reset).includes(password));
      assert.equal((await request("/api/auth/me", signedIn.token)).status, 401);
      assert.equal((await request("/api/auth/login", null, "POST", original)).status, 401);
      const replacement = await request("/api/auth/login", null, "POST", { loginId: original.loginId, password });
      assert.equal(replacement.status, 200);
      assert.equal((await request("/api/auth/me", replacement.token)).status, 200);
      const business = (await request("/api/portal/businesses", rootToken)).businesses.find((item) => item.businessId === id);
      assert.equal(business.loginId || business.loginEmail, original.loginId);
      assert.equal(business.passwordHash, undefined);
      assert.equal(business.passwordVersion, undefined);
      const controlText = await fs.readFile(path.join(temporary, "server/data/control.json"), "utf8");
      const businessText = await fs.readFile(businessesPath, "utf8");
      assert.ok(!controlText.includes(password)); assert.ok(!businessText.includes(password));
      const meta = JSON.parse(controlText);
      assert.ok(meta.audit.some((event) => event.action === "Business password reset" && event.businessId === id));
      // An in-flight old-password login could pick up the new session counter;
      // its old credential version must still invalidate that signed token.
      const stale = JSON.parse(Buffer.from(signedIn.token.split(".")[0], "base64url"));
      stale.version = meta.versions[id];
      const body = Buffer.from(JSON.stringify(stale)).toString("base64url");
      const staleToken = `${body}.${crypto.createHmac("sha256", process.env.AUTH_SECRET).update(body).digest("base64url")}`;
      assert.equal((await request("/api/auth/me", staleToken)).status, 401);
      assert.equal((await request(url, rootToken, "DELETE", { confirmName: created.business.name })).status, 200);
    }
  });
  await t.test("bulk deletion checks confirmation, current targets and permissions", async () => {
    const fresh = await login("platform@example.test", "Changed-Platform-Password");
    const snapshot = (await request("/api/portal/businesses", fresh)).businesses.map((business) => business.businessId);
    const payload = { confirmText: "DELETE ALL BUSINESSES", businessIds: snapshot };
    assert.equal((await request("/api/portal/businesses", owner, "DELETE", payload)).status, 403);
    assert.equal((await request("/api/portal/businesses", fresh, "DELETE", { ...payload, confirmText: "wrong" })).status, 400);
    assert.equal((await request("/api/portal/businesses", fresh, "DELETE", { ...payload, businessIds: [snapshot[0], snapshot[0]] })).status, 409);
    const extra = await request("/api/portal/businesses", fresh, "POST", {
      name: "New business before confirmation", loginEmail: "before-confirmation@example.test", password: "Confirmation-Test-Password", limits: { card: 10, branch: 2, account: 1 },
    });
    assert.equal(extra.status, 201);
    assert.equal((await request("/api/portal/businesses", fresh, "DELETE", payload)).status, 409);
    const current = (await request("/api/portal/businesses", fresh)).businesses;
    assert.equal(current.length, snapshot.length + 1);
    const removed = await request("/api/portal/businesses", fresh, "DELETE", { ...payload, businessIds: current.map((business) => business.businessId) });
    assert.equal(removed.status, 200);
    assert.equal(removed.deletedCount, current.length);
    assert.equal((await request("/api/portal/businesses", fresh)).businesses.length, 0);
    assert.equal((await request("/api/portal/cards", fresh)).cards.length, 0);
    assert.equal((await request("/api/portal/users", fresh)).users.length, 0);
    assert.equal((await request(`/api/cards/${cardSlug}`)).status, 404);
    assert.equal((await request("/api/auth/me", owner)).status, 401);
    const archived = JSON.parse(await fs.readFile(businessesPath, "utf8"));
    assert.ok(archived.every((business) => business.status === "deleted" && business.deletedAt));
    assert.ok((await request("/api/portal/audit", fresh)).events.some((event) => event.action === "All businesses deleted"));
    assert.equal((await request("/api/portal/businesses", fresh, "DELETE", { ...payload, businessIds: [] })).deletedCount, 0);
  });
});
