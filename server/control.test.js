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
  const { app, connectDatabase } = await import("./index.js");
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
    assert.equal(resolved.toLowerCase(), path.resolve(temporary).toLowerCase());
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
    const updated = { ...original, supportUrl: "https://example.test/help", loginMessage: "Welcome to your rewards portal", defaultLimits: { card: 500, branch: 5, account: 2 } };
    assert.equal((await request("/api/portal/settings", owner, "PUT", updated)).status, 403);
    assert.equal((await request("/api/portal/settings", admin, "PUT", updated)).status, 200);
    assert.deepEqual((await request("/api/portal/settings", admin)).settings, updated);
    const publicSettings = await request("/api/platform");
    assert.equal(publicSettings.supportUrl, updated.supportUrl);
    assert.equal(publicSettings.loginMessage, updated.loginMessage);
    assert.equal(publicSettings.defaultLimits, undefined);
    assert.deepEqual((await request("/api/portal/businesses", owner)).businesses[0].limits, { card: 100, branch: 2, account: 0 });
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
      assert.deepEqual(existing.limits, { card: 100, branch: 2, account: 0 });
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
      branchId = result.branch.branchId;
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
        shareImage: `data:image/png;base64,${previewImageBase64}`,
      });
      assert.equal(created.status, 201, created.message);
      cardSlug = created.slug;
      const cards = (await request("/api/portal/cards", owner)).cards;
      assert.equal(cards[0].senderName, "Impact Vibes");
      assert.equal(cards[0].campaignName, "Diwali");
      assert.equal(cards[0].branchId, branchId);
      assert.equal(cards[0].branchName, "Hyderabad");
      assert.equal(cards[0].language, "hi");
      assert.equal(cards[0].customerPhone, "+919876543210");
      assert.equal(cards[0].hasShareImage, true);
      assert.equal(cards[0].shareImageBase64, undefined);
      assert.equal((await request("/api/admin/coupons", owner)).coupons[0].customerPhone, "+919876543210");
      const publicResult = await request(`/api/cards/${cardSlug}`);
      assert.equal(publicResult.customerPhone, undefined);
      assert.ok(!JSON.stringify(publicResult).includes("9876543210"));
      assert.equal(publicResult.hasShareImage, true);
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
      const previewResponse = await fetch(`${base}/share/${cardSlug}?v=2`);
      const previewHtml = await previewResponse.text();
      assert.equal(previewResponse.status, 200);
      assert.match(previewHtml, /property="og:image"/);
      assert.match(previewHtml, new RegExp(`scratch\\.justconnect\\.biz/share/${cardSlug}/image\\?v=2`));
      assert.match(previewHtml, new RegExp(`scratch\\.justconnect\\.biz/card/${cardSlug}`));
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
        "Hyderabad",
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
    },
  );
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
    "scratching atomically redeems once and manual redemption is retired",
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
      assert.ok(winner.redeemedAt);
      assert.equal(winner.scratchedAt, winner.redeemedAt);
      for (const result of results) {
        assert.equal(result.customerPhone, undefined);
        assert.ok(!JSON.stringify(result).includes("9876543210"));
      }
      assert.equal((await request(`/api/cards/${cardSlug}`)).customerPhone, undefined);
      assert.equal(winner.couponCode, "TEST-UNIQUE");
      assert.equal((await request(`/api/cards/${cardSlug}`)).used, true);
      assert.equal((await request(`/api/cards/${cardSlug}`)).couponCode, undefined);
      const redeemed = (await request("/api/portal/cards", owner)).cards.find((item) => item.slug === cardSlug);
      assert.equal(redeemed.status, "redeemed");
      assert.equal(redeemed.redeemedBranchId, redeemed.branchId);
      assert.equal((await request(`/api/portal/cards/${cardSlug}/redeem`, null, "POST", { branchId })).status, 401);
      const redemptions = await Promise.all(Array.from({ length: 6 }, () => request(`/api/portal/cards/${cardSlug}/redeem`, owner, "POST", { branchId })));
      assert.equal(redemptions.filter((item) => item.status === 410).length, 6);
      assert.equal((await request(`/api/cards/${cardSlug}`)).used, true);
      assert.equal(
        (await request("/api/portal/cards", owner)).cards.find(
          (item) => item.slug === cardSlug,
        ).status,
        "redeemed",
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
            limits: { card: 1, branch: 1, account: 2 },
          })
        ).status,
        200,
      );
      assert.deepEqual(
        (await request("/api/portal/businesses", owner)).businesses[0].limits,
        { card: 1, branch: 1, account: 2 },
      );
      assert.equal(
        (
          await request("/api/portal/businesses/impact-vibes", owner, "PATCH", {
            limits: { card: 0, branch: 0, account: 0 },
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
              { limits: { card: invalid, branch: 2, account: 1 } },
            )
          ).status,
          400,
        );
      }
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
            limits: { card: 1, branch: 2, account: 2 },
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
        { card: 1, branch: 2, account: 2 },
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
  await t.test(
    "branding, audit history, revocation, and password changes persist",
    async () => {
      assert.equal(
        (
          await request("/api/portal/businesses/impact-vibes", owner, "PATCH", {
            name: "Cannot rename",
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
  await t.test("generated business and super-admin credentials are unique, scoped and never stored in plaintext", async () => {
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
    const created = await request("/api/portal/businesses", fresh, "POST", { name: "Generated Test", limits: { card: 20, branch: 2, account: 2 } });
    assert.equal(created.status, 201, created.message);
    assert.match(created.credentials.loginId, /^biz-[a-f0-9]{20}$/);
    assert.ok(created.credentials.password.length >= 24);
    assert.equal(created.business.loginId, created.credentials.loginId);
    assert.equal(created.business.loginEmail, undefined);
    assert.equal(created.business.passwordHash, undefined);
    const businessLogin = await loginById(created.credentials);
    assert.equal(businessLogin.user.role, "business");
    assert.equal((await request("/api/portal/businesses", businessLogin.token)).businesses.length, 1);
    assert.equal((await request("/api/portal/cards?business=impact-vibes", businessLogin.token)).status, 403);
    assert.equal((await request("/api/portal/super-admins", businessLogin.token)).status, 403);
    const member = await request("/api/portal/users", fresh, "POST", { businessId: created.business.businessId, name: "Generated editor", role: "editor" });
    assert.equal(member.status, 201, member.message);
    assert.match(member.credentials.loginId, /^user-[a-f0-9]{20}$/);
    assert.equal((await loginById(member.credentials)).user.role, "editor");
    const others = await Promise.all(["Generated admin 1", "Generated admin 2"].map((name) => request("/api/portal/super-admins", fresh, "POST", { name })));
    for (const result of others) {
      assert.equal(result.status, 201, result.message);
      assert.match(result.credentials.loginId, /^sa-[a-f0-9]{20}$/);
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
    assert.equal((await request("/api/portal/security/password", secondAdmin.token, "POST", { currentPassword: others[0].credentials.password, password: "Changed-Generated-Password" })).status, 200);
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
    assert.equal((await request(`/api/portal/businesses/${created.business.businessId}`, fresh, "DELETE", { confirmName: "Generated Test" })).status, 200);
    assert.equal((await request("/api/auth/me", businessLogin.token)).status, 401);
  });
  await t.test("super admins reset business passwords without exposing secrets and revoke old sessions", async () => {
    const rootToken = await login("platform@example.test", "Changed-Platform-Password");
    for (const legacy of [false, true]) {
      const created = await request("/api/portal/businesses", rootToken, "POST", {
        name: legacy ? "Legacy reset test" : "Generated reset test",
        limits: { card: 10, branch: 1, account: 1 },
        ...(legacy ? { loginEmail: "legacy-reset@example.test", password: "Original-Reset-Password" } : {}),
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
