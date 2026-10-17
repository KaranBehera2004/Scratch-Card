import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

let fixture;
test.beforeAll(async () => {
  fixture = await import("./fixture-server.js");
  await fixture.ready;
});
test.afterAll(async () => {
  await fixture?.close();
});

const login = async (page, email, password) => {
  await page.goto("/");
  await page.getByLabel("Login ID", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to dashboard" }).click();
  await expect(page.locator(".p-welcome-row")).toBeVisible();
};
const nav = (page, name) =>
  page
    .locator(".p-sidebar nav")
    .getByRole("button", { name: name === "Departments" ? "Branches & Departments" : name, exact: true })
    .click();
const expandBranchGroups = async (page) => {
  await expect(page.locator(".p-branch-toggle").first()).toBeVisible();
  const collapsed = page.locator('.p-branch-toggle[aria-expanded="false"]');
  while (await collapsed.count()) await collapsed.first().click();
};
const createdCredentials = async (page) => {
  const popup = page.getByRole("dialog", { name: "Login credentials", exact: true });
  await expect(popup).toBeVisible();
  const credentials = {
    loginId: await popup.getByLabel("Login ID", { exact: true }).inputValue(),
    password: await popup.getByLabel("Password", { exact: true }).inputValue(),
  };
  expect(credentials.password.length).toBeGreaterThan(0);
  await popup.getByRole("button", { name: "Done", exact: true }).click();
  await expect(popup).not.toBeVisible();
  return credentials;
};

test("favicon follows live browser theme changes without refreshing the page", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const loadedAt = await page.evaluate(() => performance.timeOrigin);

  for (const theme of ["light", "dark", "light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    const icon = page.locator("#app-favicon");
    await expect(icon).toHaveAttribute("href", `/favicon-${theme}.png?v=justconnect-2`);
    await expect(icon).toHaveAttribute("type", "image/png");
    await expect(icon).toHaveAttribute("media", `(prefers-color-scheme: ${theme})`);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(loadedAt);
  }

  // Native media-specific icons remain available when a background tab's JS
  // is suspended. A stale managed icon cannot override the opposite theme.
  for (const theme of ["light", "dark"]) {
    const variant = page.locator(`link[data-favicon-theme="${theme}"]`);
    await expect(variant).toHaveAttribute("media", `(prefers-color-scheme: ${theme})`);
    const response = await page.request.get(await variant.getAttribute("href"));
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }

  await page.evaluate(() => {
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("resume"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#app-favicon")).toHaveCount(1);
  await expect(page.locator("#app-favicon")).toHaveAttribute("href", /favicon-dark\.png/);
});

test("public coupon links show safe error screens and recover from temporary failures", async ({ page }, info) => {
  // Persistent failures wait through the card loader's automatic retries.
  test.slow();
  const auth = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const headers = { Authorization: `Bearer ${(await auth.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers, data: {
    name: "Public error screen business", loginId: "PUBLICUI88", password: "Public-UI-Password",
    limits: { card: 0, branch: 0, department: 0, account: 0 },
  } });
  expect(created.status()).toBe(201);
  const { business } = await created.json();
  const createCard = async couponCode => {
    const response = await page.request.post("/api/cards", { headers, data: {
      businessId: business.businessId, headline: "A little surprise for you", offerTitle: "25% OFF",
      description: "Your next visit", couponCode, customerPhone: "9876543210",
    } });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const card = await createCard("PUBLIC-SAFE-REWARD");
  const disabled = await createCard("PUBLIC-DISABLED");
  expect((await page.request.patch(`/api/portal/cards/${disabled.slug}`, { headers, data: { disabled: true } })).status()).toBe(200);
  const disabledPage = await page.goto(`/share/${disabled.slug}?v=5`);
  expect(disabledPage.status()).toBe(410);
  await expect(page.getByRole("heading", { name: "This coupon has been disabled", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(disabled.couponCode);
  expect((await page.request.post(`/api/cards/${card.slug}/claim`)).status()).toBe(200);
  const goodShare = await page.request.get(`/share/${card.slug}?v=5`);
  expect(goodShare.status()).toBe(200);
  expect(await goodShare.text()).toContain(`/card/${card.slug}`);
  await page.goto(`/card/${card.slug}`);
  await expect(page.getByText(card.couponCode, { exact: false })).toBeVisible();
  await expect(page.locator(".scratch-card canvas")).toHaveCount(0);
  // A sleeping or redeploying API is retried quietly: one temporary failure
  // must recover without the customer ever seeing an error screen.
  const apiPath = `**/api/cards/${card.slug}`;
  let coldStartRequests = 0;
  await page.route(apiPath, route => ++coldStartRequests > 1 ? route.fallback()
    : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Cold start" }) }));
  await page.goto(`/card/${card.slug}`);
  await expect(page.getByText(card.couponCode, { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: "We couldn’t load your coupon", exact: true })).toHaveCount(0);
  expect(coldStartRequests).toBe(2);
  await page.unroute(apiPath);
  // HTML gateway responses, private server exceptions and offline failures
  // that persist through every retry must show the safe temporary screen,
  // never technical details. Unexpected response shapes are not retried.
  for (const kind of ["html", "private-error", "offline", "invalid-json"]) {
    let requests = 0;
    const failures = kind === "invalid-json" ? 1 : 3;
    await page.route(apiPath, route => {
      if (++requests > failures) return route.fallback();
      if (kind === "offline") return route.abort("failed");
      if (kind === "html") return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Internal proxy details</h1>" });
      return route.fulfill({ status: kind === "invalid-json" ? 200 : 503, contentType: "application/json",
        body: JSON.stringify({ message: "mongodb://private-password@internal-host" }) });
    });
    await page.goto(`/card/${card.slug}`);
    await expect(page.getByRole("heading", { name: "We couldn’t load your coupon", exact: true })).toBeVisible({ timeout: 15000 });
    expect(requests).toBe(failures);
    await expect(page.locator("body")).not.toContainText("private-password");
    await expect(page.locator("body")).not.toContainText("Internal proxy details");
    await expect(page.locator("body")).not.toContainText(card.couponCode);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText(card.couponCode, { exact: false })).toBeVisible();
    await page.unroute(apiPath);
  }
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, { headers, data: { confirmName: business.name } })).status()).toBe(200);
  const share = await page.goto(`/share/${card.slug}?v=5`);
  expect(share.status()).toBe(404);
  expect(share.headers()["content-type"]).toContain("text/html");
  expect(share.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { name: "This coupon is no longer available", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Business not found.");
  await expect(page.locator("body")).not.toContainText(card.couponCode);
  await page.screenshot({ path: info.outputPath("share-business-unavailable-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("share-business-unavailable-mobile.png"), fullPage: true });
  await page.goto(`/card/${card.slug}`);
  await expect(page.getByRole("heading", { name: "This coupon is no longer available", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a scratch card", exact: true })).toHaveCount(0);
  await expect(page.locator(".arrival-celebration")).toHaveCount(0);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("card-business-unavailable-mobile.png"), fullPage: true });
  for (const invalid of ["/share/bad", "/share", "/card", "/card/not/a/link"]) {
    await page.goto(invalid);
    await expect(page.getByRole("heading", { name: "We couldn’t find this coupon", exact: true })).toBeVisible();
    await expect(page.locator(".p-login")).toHaveCount(0);
  }
});

test("expired coupon links show a disabled reward card without exposing the code", async ({ page }) => {
  await page.route("**/api/cards/expired-ui", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      slug: "expired-ui",
      senderName: "Dev Technologies",
      headline: "A little surprise for you",
      offerTitle: "25% OFF",
      description: "On your next order",
      branchId: "marketing",
      branchName: "Marketing",
      language: "en",
      accentColor: "#f6a800",
      pageColor: "#002b5c",
      textColor: "#ffffff",
      expiresAt: "2020-01-01T00:00:00.000Z",
      expired: true,
      used: false,
    }),
  }));
  await page.goto("/card/expired-ui");
  await expect(page.locator(".scratch-shell")).toHaveClass(/is-expired/);
  await expect(page.locator(".scratch-card canvas")).toHaveCount(0);
  await expect(page.locator(".scratch-card .offer-content strong")).toHaveText("25% OFF");
  await expect(page.locator(".expired-coupon-label")).toHaveText("COUPON IS EXPIRED");
  await expect(page.getByRole("heading", { name: "A little surprise for you" })).toHaveCount(0);
  await expect(page.getByText("A surprise was sent to you")).toHaveCount(0);
  await expect(page.locator(".scratch-shell .progress")).toHaveCount(1);
  await expect(page.getByText("This coupon has expired and can no longer be redeemed.")).toHaveCount(0);
  await expect(page.locator(".recipient-actions")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("LUCKY-");
});

test("compact typography stays readable and sidebar navigation remains accessible", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator(".p-login")).toHaveCSS("font-size", "14px");
  await expect(page.getByLabel("Login ID", { exact: true })).toHaveCSS("font-size", "14px");
  await expect(page.locator(".p-login-form h2")).toHaveCSS("font-size", "31px");
  await login(page, "platform@example.test", "Platform-Test-Password");
  await expect(page.locator(".p-shell")).toHaveCSS("font-size", "14px");
  await expect(page.locator(".p-sidebar nav button").first()).toHaveCSS("font-size", "13px");
  await expect(page.locator(".p-sidebar nav")).toHaveCSS("scrollbar-width", "thin");
  await nav(page, "Businesses");
  await expect(page.locator(".p-page-heading h1")).toHaveCSS("font-size", "28px");
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.screenshot({ path: info.outputPath("compact-dark-businesses.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 600 });
  const lastNavItem = page.locator(".p-sidebar nav button").last();
  await lastNavItem.scrollIntoViewIfNeeded();
  await expect(lastNavItem).toBeInViewport();
  await expect(page.locator(".p-sidebar-account")).toBeInViewport();
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Login ID", { exact: true })).toHaveCSS("font-size", "16px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("compact-mobile-login.png"), fullPage: true });
});

test("super admin can manage workspaces, create rewards, and export English workbooks", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
  await login(page, "platform@example.test", "Platform-Test-Password");
  await expect(page.locator(".p-sidebar nav").getByRole("button", { name: "Coupons", exact: true })).toHaveCount(0);
  await expect(page.locator(".p-metrics article").filter({ hasText: "Total scratch cards" }).locator("strong")).toHaveText("0");
  const themeToggle = page.getByRole("switch", { name: "Dark mode" });
  await themeToggle.click();
  await expect(page.locator(".p-shell")).toHaveAttribute("data-theme", "dark");
  await expect(themeToggle).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(page.locator(".p-shell")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: info.outputPath("superadmin.png"),
    fullPage: true,
  });
  await nav(page, "Businesses");
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Businesses");
  await expect(page.getByText(/Passwords are protected with one-way hashing/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("dark-businesses.png"), fullPage: true });
  await expect(
    page
      .locator(".p-sidebar nav")
      .getByRole("button", { name: "Plans & limits", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create business", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("width", "820px");
  await expect(dialog).toHaveCSS("background-color", "rgb(27, 35, 50)");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth
      && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath("business-dialog-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByLabel("Business name").fill("Orbit Retail");
  await expect(dialog.getByLabel("Owner login email")).toHaveCount(0);
  await expect(dialog.getByLabel("Login ID (optional)")).toHaveValue("");
  await dialog.getByLabel("Login ID (optional)").fill("ORBIT58");
  await dialog.getByLabel("Password", { exact: true }).fill("ORBITPASS58F");
  await dialog.getByLabel("Confirm password", { exact: true }).fill("ORBITPASS58F");
  await expect(dialog.getByLabel("Department limit", { exact: true })).toHaveValue(
    "2",
  );
  await expect(dialog.getByLabel("Branch limit", { exact: true })).toHaveValue("2");
  await expect(dialog.getByLabel("Business account limit")).toHaveValue("1");
  await expect(
    dialog.getByRole("combobox", { name: "Subscription plan" }),
  ).toHaveCount(0);
  await dialog.getByLabel("Scratch-card limit").fill("250");
  await dialog.getByLabel("Department limit", { exact: true }).fill("4");
  await dialog.getByLabel("Branch limit", { exact: true }).fill("3");
  await dialog.getByLabel("Business account limit").fill("3");
  await page.screenshot({
    path: info.outputPath("business-limits.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save changes" }).click();
  const orbitCredentials = await createdCredentials(page);
  expect(orbitCredentials.loginId).toBe("ORBIT58");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Orbit Retail" }),
  ).toBeVisible();
  const businessRow = page.getByRole("row").filter({ hasText: "Orbit Retail" });
  await expect(businessRow).toContainText(orbitCredentials.loginId);
  await expect(businessRow).not.toContainText(orbitCredentials.password);
  await expect(businessRow).toContainText("250 scratch cards");
  await expect(businessRow).toContainText("4 departments");
  await expect(businessRow).toContainText("3 branches");
  await expect(businessRow).toContainText("3 business accounts");
  const notice = page.getByRole("status");
  await expect(notice).toContainText("Changes saved successfully.");
  await expect(notice).toHaveCSS("font-size", "14px");
  expect(await notice.evaluate((element) => element.clientWidth > 300 && element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.screenshot({ path: info.outputPath("success-notification.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await notice.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(notice).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await themeToggle.click();
  await expect(page.locator(".p-shell")).toHaveAttribute("data-theme", "light");
  await businessRow
    .getByRole("button", { name: "Manage", exact: true })
    .click();
  await expect(dialog.getByLabel("Department limit", { exact: true })).toHaveValue(
    "4",
  );
  await expect(dialog.getByLabel("Owner login ID")).toHaveValue("ORBIT58");
  await dialog.getByRole("button", { name: "Generate new", exact: true }).click();
  await expect(dialog.getByLabel("Owner login ID")).toHaveValue(/^(?=.*[A-Z])(?=.*\d)[A-Z\d]{12}$/);
  await dialog.getByLabel("Owner login ID").fill("ORBIT59");
  await dialog.getByLabel("Department limit", { exact: true }).fill("2");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(businessRow).toContainText("ORBIT59");
  await expect(businessRow).toContainText("2 departments");
  await nav(page, "Departments");
  await page.getByRole("button", { name: "Add branches & departments", exact: true }).click();
  const capacityDialog = page.getByRole("dialog", { name: "Add branches and departments" });
  await capacityDialog.getByRole("combobox", { name: "Business", exact: true }).selectOption({ label: "Orbit Retail" });
  await expect(capacityDialog.getByLabel("Number of branches")).toHaveAttribute("max", "2");
  const capacityBranchCount = capacityDialog.getByLabel("Number of departments");
  await expect(capacityBranchCount).toHaveAttribute("max", "2");
  await capacityBranchCount.fill("5");
  await expect(capacityBranchCount).toHaveValue("2");
  await expect(capacityDialog).toContainText("2 of 2 department slots remaining");
  await capacityDialog.getByRole("button", { name: "Cancel" }).click();
  await nav(page, "Businesses");
  const impactBusinessRow = page.getByRole("row").filter({ hasText: "Impact Vibes" });
  await expect(impactBusinessRow.getByRole("button", { name: "Delete all coupons", exact: true })).toBeVisible();
  await impactBusinessRow.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.locator(".p-workspace-banner")).toContainText(
    "Impact Vibes",
  );
  await nav(page, "Departments");
  await page.getByRole("button", { name: "Add department", exact: true }).click();
  await dialog.getByLabel("Department name").fill("Hyderabad");
  await dialog.getByLabel("Address").fill("Jubilee Hills");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expandBranchGroups(page);
  await expect(
    page.getByRole("cell", { name: "Hyderabad", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add branches & departments", exact: true }).click();
  const hierarchyDialog = page.getByRole("dialog", { name: "Add branches and departments" });
  await hierarchyDialog.getByLabel("Branch name").fill("Secunderabad");
  await hierarchyDialog.getByLabel("Department name").fill("Sales");
  await hierarchyDialog.getByLabel("Address optional").fill("Main showroom");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await hierarchyDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await hierarchyDialog.getByRole("button", { name: "Create 1 branch and 1 department" }).click();
  await expect(hierarchyDialog).not.toBeVisible();
  await expect(page.locator(".p-branch-toggle").filter({ hasText: "Secunderabad" })).toBeVisible();
  await expandBranchGroups(page);
  await expect(page.getByRole("cell", { name: "Sales", exact: true })).toBeVisible();
  await expect(page.locator(".p-branch-toggle").filter({ hasText: "Secunderabad" })).toBeVisible();
  await page.getByRole("button", { name: "Return to super admin" }).click();
  await nav(page, "Business accounts");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Business", exact: true })
    .selectOption("impact-vibes");
  await dialog.getByLabel("Full name").fill("Rewards Editor");
  await dialog.getByLabel("Password", { exact: true }).fill("editor password!");
  await dialog.getByLabel("Confirm password", { exact: true }).fill("editor password!");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  const editorCredentials = await createdCredentials(page);
  await expect(page.getByText(editorCredentials.loginId)).toBeVisible();
  await nav(page, "Businesses");
  await page
    .getByRole("row")
    .filter({ hasText: "Impact Vibes" })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await nav(page, "Create scratch card");
  await expect(
    page.getByRole("textbox", { name: "From", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".phone-brand")).toHaveText("✦ Impact Vibes");
  await expect(page.locator(".scratch-card .offer-branch")).toHaveText("All departments");
  await page.getByLabel("Campaign name").fill("Diwali rewards");
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption({ label: "Hyderabad" });
  await expect(page.locator(".phone-brand")).toHaveText("✦ Impact Vibes");
  await expect(page.locator(".scratch-card .offer-branch")).toHaveText("Hyderabad");
  await expect(page.getByRole("combobox", { name: "Department", exact: true })).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("card-builder.png"),
    fullPage: true,
  });
  await themeToggle.click();
  await page.getByLabel("WhatsApp number", { exact: true }).fill("9876543210");
  await page.getByRole("button", { name: "Create scratch-card link" }).click();
  await expect(
    page.getByRole("textbox", { name: "Share link", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".modal")).toHaveCSS("background-color", "rgb(27, 35, 50)");
  await expect(page.locator(".modal h2")).toHaveCSS("color", "rgb(237, 240, 247)");
  await page.screenshot({ path: info.outputPath("dark-share-popup.png"), fullPage: true });
  const createdCouponCode = (await page.locator(".created-code strong").textContent()).trim();
  const shareUrl = await page
    .getByRole("textbox", { name: "Share link", exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Create another" }).click();
  await expect(page.getByRole("button", { name: "Single Card", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Coupon code")).not.toHaveValue(createdCouponCode);
  await themeToggle.click();
  await nav(page, "Coupons");
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Coupons");
  await expect(page.locator(".p-workspace-banner")).toContainText("Impact Vibes");
  await expect(
    page.getByRole("cell", { name: "Diwali rewards" }),
  ).toBeVisible();
  const couponRow = page.getByRole("row").filter({ hasText: "Diwali rewards" });
  const claimRequests = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/claim")) claimRequests.push(request.url());
  });
  await couponRow.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Scratch-card preview" });
  await expect(preview.getByText("25% OFF", { exact: true })).toBeVisible();
  await expect(preview.locator(".p-preview-brand")).toHaveText("✦ Impact Vibes");
  await expect(preview.locator(".scratch-card .offer-branch")).toHaveText("Hyderabad");
  await expect(preview.locator("canvas")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("coupon-preview.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(preview).not.toBeVisible();
  expect(claimRequests).toEqual([]);
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(couponRow.locator(".p-badge")).toHaveText("available");
  await page.screenshot({
    path: info.outputPath("coupons.png"),
    fullPage: true,
  });
  await expect(page.locator(".p-topbar select")).toHaveValue("en");
  for (const [language, expected] of [["en", "Coupon"]]) {
    const pending = page.waitForEvent("download");
    await page.locator(".p-toolbar .p-button").click();
    const download = await pending;
    expect(download.suggestedFilename()).toContain(`coupons-${language}`);
    const archive = unzipSync(await fs.readFile(await download.path()));
    expect(Object.keys(archive)).toContain("xl/workbook.xml");
    const text = Object.values(archive)
      .map((value) => strFromU8(value))
      .join(" ");
    expect(text).toContain(expected);
    expect(text).toContain("25% OFF");
  }
  await page.getByRole("button", { name: "Return to super admin" }).click();
  await expect(page.locator(".p-metrics article").filter({ hasText: "Total scratch cards" }).locator("strong")).toHaveText("1");
  await nav(page, "Campaigns");
  await page.getByLabel("Filter by business").selectOption("impact-vibes");
  const adminCampaignRow = page.getByRole("row").filter({ hasText: "Diwali rewards" });
  await expect(adminCampaignRow).toContainText("Impact Vibes");
  await expect(adminCampaignRow.getByRole("button", { name: "Manage business" })).toBeVisible();
  await nav(page, "Scratch cards");
  await page.getByLabel("Filter by business").selectOption("impact-vibes");
  await expect(page.getByRole("columnheader", { name: "Business" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Department" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Diwali rewards" })).toContainText("Hyderabad");
  await nav(page, "Departments");
  await page.getByLabel("Filter by business").selectOption("impact-vibes");
  const adminBranchRow = page.getByRole("row").filter({ hasText: "Hyderabad" });
  await expandBranchGroups(page);
  await expect(adminBranchRow).toContainText("Impact Vibes");
  await expect(adminBranchRow.getByRole("button", { name: "Manage business" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("superadmin-branch-control.png"), fullPage: true });
  for (const tab of [
    "Campaigns",
    "Scratch cards",
    "Departments",
    "Business accounts",
    "Analytics",
    "Security",
    "Audit",
    "Platform settings",
  ]) {
    await nav(page, tab);
    await expect(page.locator(".p-page-heading h1")).toHaveText(tab);
    await expect(page.locator(".p-alert.error")).toHaveCount(0);
    if (tab === "Security") {
      await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
      await page.getByRole("button", { name: "Change password to set a new value" }).click();
      const passwordDialog = page.getByRole("dialog", { name: "Change your password" });
      await expect(passwordDialog.getByLabel("Current password", { exact: true })).toBeVisible();
      await expect(passwordDialog.getByLabel("New password", { exact: true })).toBeVisible();
      await expect(passwordDialog.getByLabel("Confirm new password", { exact: true })).toBeVisible();
      await passwordDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  }
  await nav(page, "Businesses");
  const orbitRow = page.getByRole("row").filter({ hasText: "Orbit Retail" });
  await orbitRow.getByRole("button", { name: "Delete", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete business", exact: true });
  await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(orbitRow).toBeVisible();
  await orbitRow.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteDialog.getByLabel("Type Orbit Retail to confirm").fill("Wrong name");
  await deleteDialog.getByRole("button", { name: "Delete business", exact: true }).click();
  await expect(deleteDialog.getByRole("alert")).toContainText("Type the exact business name");
  await deleteDialog.getByLabel("Type Orbit Retail to confirm").fill("Orbit Retail");
  await page.screenshot({ path: info.outputPath("delete-business.png"), fullPage: true });
  await deleteDialog.getByRole("button", { name: "Delete business", exact: true }).click();
  await expect(deleteDialog).not.toBeVisible();
  await expect(orbitRow).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Business deleted.");
  await page
    .locator(".p-topbar")
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.goto(shareUrl);
  await expect(page.locator(".recipient-brand")).toHaveText("✦ Impact Vibes");
  await expect(page.locator(".scratch-card .offer-branch")).toHaveText("Hyderabad");
  await expect(page.locator(".scratch-card canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeVisible();
  const openedSlug = new URL(shareUrl).pathname.split("/").filter(Boolean).at(-1);
  const openedRootLogin = await page.request.post("/api/auth/login", {
    data: { loginId: "platform@example.test", password: "Platform-Test-Password" },
  });
  const openedRootHeaders = { Authorization: `Bearer ${(await openedRootLogin.json()).token}` };
  const openedCards = await page.request.get("/api/portal/cards?business=impact-vibes", {
    headers: openedRootHeaders,
  });
  const openedCard = (await openedCards.json()).cards.find((item) => item.slug === openedSlug);
  expect(openedCard.status).toBe("opened");
  expect(openedCard.openedAt).toBeTruthy();
  expect(openedCard.scratchedAt).toBeFalsy();
  const box = await page.locator(".scratch-card canvas").boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  for (let y = 15; y < box.height; y += 22) {
    await page.mouse.move(box.x + 10, box.y + y);
    await page.mouse.move(box.x + box.width - 10, box.y + y, { steps: 12 });
  }
  await page.mouse.up();
  await expect(page.getByText("Offer unlocked!")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go back", exact: true })).toBeVisible();
  await expect(page.locator(".scratch-card .offer-branch")).toHaveText("Hyderabad");
  await page.reload();
  await expect(page.locator(".scratch-card canvas")).toHaveCount(0);
  await expect(page.locator(".scratch-card .offer-content strong")).toHaveText("25% OFF");
  await expect(page.locator(".scratch-card .offer-content b")).toContainText(createdCouponCode);
  await expect(page.getByRole("link", { name: "Create a new scratch card" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("analytics shows every coupon status, reconciles totals and refreshes expiry without double counting", async ({ page }, info) => {
  const past = "2020-01-01T00:00:00.000Z";
  const businesses = Array.from({ length: 6 }, (_, index) => ({
    businessId: `analytics-${index}`, name: `Analytics business ${index + 1}`, status: "active",
    departments: [{ departmentId: `location-${index}`, name: `Location ${index + 1}`, status: "active" }],
    branches: [{ branchId: `sales-${index}`, departmentId: `location-${index}`, name: "Sales", status: "active" }],
  }));
  let cards = [
    ...Array.from({ length: 44 }, () => ({ status: "available" })),
    ...Array.from({ length: 10 }, () => ({ status: "opened", openedAt: past })),
    ...Array.from({ length: 12 }, () => ({ status: "scratched", scratchedAt: past })),
    ...Array.from({ length: 15 }, () => ({ status: "redeemed", staffRedeemedAt: past, used: true })),
    ...Array.from({ length: 8 }, () => ({ status: "scratched", scratchedAt: past, expiresAt: past })),
    ...Array.from({ length: 5 }, () => ({ status: "scratched", scratchedAt: past, disabled: true })),
  ].map((card, index) => ({
    slug: `analytics-card-${index}`, couponCode: `ANALYTICS-${index}`, createdAt: past,
    businessId: `analytics-${index % 6}`, branchId: `sales-${index % 6}`, branchName: "Sales",
    senderName: `Analytics business ${index % 6 + 1}`, ...card,
  }));
  await page.route("**/api/portal/businesses", (route) => route.fulfill({ json: { businesses } }));
  await page.route("**/api/portal/cards", (route) => route.fulfill({ json: { cards } }));
  await login(page, "platform@example.test", "Platform-Test-Password");
  await nav(page, "Analytics");
  const summary = page.getByLabel("Analytics summary", { exact: true });
  await expect(summary.locator("article")).toHaveCount(9);
  await expect(summary.locator("article").filter({ has: page.getByText("Businesses", { exact: true }) }).locator("strong")).toHaveText("6");
  await expect(summary.locator("article").filter({ hasText: "Total scratch cards" }).locator("strong")).toHaveText("94");
  await expect(summary.locator("article").filter({ hasText: "Redemption rate" }).locator("strong")).toHaveText("16%");
  for (const [status, count] of Object.entries({ available: 44, opened: 10, scratched: 12, redeemed: 15, expired: 8, disabled: 5 }))
    await expect(summary.locator(`article[data-status="${status}"] strong`)).toHaveText(String(count));
  expect(await summary.locator("article[data-status] strong").evaluateAll((elements) =>
    elements.reduce((total, element) => total + Number(element.textContent), 0))).toBe(94);
  await expect(page.locator(".p-analytics-breakdown")).toContainText("15 ÷ 94 × 100 = 16%");
  await page.screenshot({ path: info.outputPath("analytics-all-statuses-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("analytics-all-statuses-mobile.png"), fullPage: true });
  cards[0] = { ...cards[0], expiresAt: past };
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(summary.locator('article[data-status="available"] strong')).toHaveText("43");
  await expect(summary.locator('article[data-status="expired"] strong')).toHaveText("9");
  cards = [];
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(summary.locator("article").filter({ hasText: "Total scratch cards" }).locator("strong")).toHaveText("0");
  await expect(summary.locator("article").filter({ hasText: "Redemption rate" }).locator("strong")).toHaveText("0%");
  await expect(page.locator(".p-analytics-breakdown")).toContainText("No coupons yet. Redemption rate is 0%.");
});

test("hierarchy defaults populate every branch and removing panels preserves the other drafts", async ({ page }, info) => {
  const rootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const headers = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers, data: {
    name: "Hierarchy Draft Test", password: "Hierarchy-Draft-Password", limits: { card: 10, branch: 12, department: 5, account: 1 },
  } });
  expect(created.status()).toBe(201);
  const { business } = await created.json();
  await login(page, "platform@example.test", "Platform-Test-Password");
  await page.goto(`/?business=${business.businessId}&tab=Branches`);
  await page.getByRole("button", { name: "Add branches & departments", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add branches and departments", exact: true });
  const panels = dialog.locator("fieldset");
  const branchCount = dialog.getByRole("spinbutton", { name: "Number of branches", exact: true });
  const defaultCount = dialog.getByRole("spinbutton", { name: "Departments per branch", exact: true });
  await defaultCount.fill("2");
  await branchCount.fill("3");
  await expect(panels).toHaveCount(3);
  for (const [index, name] of ["Ameerpet", "Discard branch", "Punjagutta"].entries()) {
    const panel = panels.nth(index);
    await expect(panel.getByRole("spinbutton", { name: "Number of departments", exact: true })).toHaveValue("2");
    await panel.getByRole("textbox", { name: "Branch name", exact: true }).fill(name);
    await panel.getByRole("textbox", { name: "Department name", exact: true }).nth(0).fill("Sales");
    await panel.getByRole("textbox", { name: "Department name", exact: true }).nth(1).fill("Service");
  }
  await panels.nth(2).getByRole("spinbutton", { name: "Number of departments", exact: true }).fill("3");
  await panels.nth(2).getByRole("textbox", { name: "Department name", exact: true }).nth(2).fill("Support");
  await panels.nth(2).getByRole("textbox", { name: "Address optional", exact: true }).nth(0).fill("Punjagutta showroom");
  await dialog.getByRole("button", { name: "Remove branch 2", exact: true }).click();
  await expect(branchCount).toHaveValue("2");
  await expect(panels.nth(1).getByRole("textbox", { name: "Branch name", exact: true })).toHaveValue("Punjagutta");
  await expect(panels.nth(1).getByRole("textbox", { name: "Department name", exact: true }).nth(2)).toHaveValue("Support");
  await expect(panels.nth(1).getByRole("textbox", { name: "Address optional", exact: true }).nth(0)).toHaveValue("Punjagutta showroom");
  await expect(dialog.getByRole("button", { name: "Create 2 branches and 5 departments", exact: true })).toBeEnabled();
  await dialog.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath("hierarchy-defaults-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).resolves.toBe(true);
  const remove = dialog.getByRole("button", { name: "Remove branch 1", exact: true });
  await remove.scrollIntoViewIfNeeded();
  await expect(remove).toBeInViewport();
  await page.screenshot({ path: info.outputPath("hierarchy-remove-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await defaultCount.fill("100");
  await expect(defaultCount).toHaveValue("6");
  for (let index = 0; index < 2; index++)
    await expect(panels.nth(index).getByRole("spinbutton", { name: "Number of departments", exact: true })).toHaveValue("6");
  await branchCount.fill("3");
  await expect(branchCount).toHaveValue("2");
  await dialog.getByRole("button", { name: "Remove branch 1", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove branch 1", exact: true }).click();
  await expect(panels).toHaveCount(0);
  await expect(branchCount).toHaveValue("0");
  await expect(dialog.getByRole("button", { name: "Create 0 branches and 0 departments", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Add branch", exact: true }).click();
  await defaultCount.fill("2");
  await expect(panels).toHaveCount(1);
  await panels.getByRole("textbox", { name: "Branch name", exact: true }).fill("SR Nagar");
  await panels.getByRole("textbox", { name: "Department name", exact: true }).nth(0).fill("Sales");
  await panels.getByRole("textbox", { name: "Department name", exact: true }).nth(1).fill("Service");
  const saved = page.waitForResponse((response) => response.url().endsWith(`/businesses/${business.businessId}/departments/branches`) && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create 1 branch and 2 departments", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().departments).toEqual([{ name: "SR Nagar", branches: [{ name: "Sales", address: "" }, { name: "Service", address: "" }] }]);
  await expect(dialog).not.toBeVisible();
  // Saved branches are collapsed groups; open SR Nagar to see both departments.
  const savedBranch = page.locator(".p-branch-group").filter({ has: page.locator(".p-branch-toggle", { hasText: "SR Nagar" }) });
  await savedBranch.locator(".p-branch-toggle").click();
  await expect(savedBranch.getByRole("row").filter({ has: page.getByRole("cell", { name: /^(Sales|Service)$/ }) })).toHaveCount(2);
  const cleanup = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, { headers: { Authorization: `Bearer ${(await cleanup.json()).token}` }, data: { confirmName: business.name } })).status()).toBe(200);
});

test("super admin can reset a forgotten business password without changing its login ID", async ({ page, browser }, info) => {
  const rootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const rootHeaders = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers: rootHeaders,
    data: { name: "Password Reset UI Test", password: "RESETUIPASS58", limits: { card: 5, branch: 1, account: 1 } } });
  expect(created.status()).toBe(201);
  const { business, credentials } = await created.json();
  const previousLogin = await page.request.post("/api/auth/login", { data: credentials });
  const previousToken = (await previousLogin.json()).token;
  const ownerContext = await browser.newContext();
  try {
    const ownerPage = await ownerContext.newPage();
    await login(ownerPage, credentials.loginId, credentials.password);
    await login(page, "platform@example.test", "Platform-Test-Password");
    await nav(page, "Businesses");
    await page.getByRole("row").filter({ hasText: business.name }).getByRole("button", { name: "Reset password", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reset business password" });
    await expect(dialog.getByLabel("Owner login ID")).toHaveValue(credentials.loginId);
    await expect(dialog.getByLabel("Owner login ID")).toHaveAttribute("readonly", "");
    await dialog.getByLabel("New password", { exact: true }).fill("New-Owner-Password!234");
    await dialog.getByLabel("Confirm new password", { exact: true }).fill("Different-Password!234");
    await dialog.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Passwords do not match.");
    expect((await page.request.get("/api/auth/me", { headers: { Authorization: `Bearer ${previousToken}` } })).status()).toBe(200);
    await dialog.getByLabel("Confirm new password", { exact: true }).fill("New-Owner-Password!234");
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("reset-business-password-mobile.png"), fullPage: true,
      mask: [dialog.locator('input[type="password"]')] });
    await dialog.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect((await page.request.get("/api/auth/me", { headers: { Authorization: `Bearer ${previousToken}` } })).status()).toBe(401);
    expect((await page.request.post("/api/auth/login", { data: credentials })).status()).toBe(401);
    await ownerPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(ownerPage.getByLabel("Login ID", { exact: true })).toBeVisible();
    await login(ownerPage, credentials.loginId, "New-Owner-Password!234");
    await expect(ownerPage.locator(".p-workspace-chip b")).toHaveText(business.name);
    await expect(ownerPage.getByRole("button", { name: "Reset password", exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("row").filter({ hasText: business.name }).getByRole("button", { name: "Open workspace" }).click();
    await nav(page, "Business settings");
    await expect(page.getByLabel("Login ID")).toBeDisabled();
    const protectedPassword = page.getByLabel("Password", { exact: true });
    await expect(protectedPassword).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Reset password to reveal a new value" }).click();
    const settingsReset = page.getByRole("dialog", { name: `Reset ${business.name} owner password` });
    await settingsReset.getByRole("textbox", { name: /^New password/ }).fill("Visible-Owner-Password!345");
    await settingsReset.getByRole("textbox", { name: /^Confirm new password/ }).fill("Visible-Owner-Password!345");
    await settingsReset.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(settingsReset).not.toBeVisible();
    await expect(protectedPassword).toHaveValue("Visible-Owner-Password!345");
    await expect(protectedPassword).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(protectedPassword).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await expect(protectedPassword).toHaveAttribute("type", "password");
  } finally {
    await ownerContext.close();
    await page.request.delete(`/api/portal/businesses/${business.businessId}`, { headers: rootHeaders, data: { confirmName: business.name } });
  }
});

test("card language is independent and persists in previews and shared links", async ({ page, context }, info) => {
  await login(page, "owner@example.test", "Owner-Test-Password");
  for (const [language, offer, reward] of [
    ["hi", "25% छूट", "आपका इनाम"],
    ["te", "25% తగ్గింపు", "మీ బహుమతి"],
  ]) {
    await nav(page, "Create scratch card");
    await page.getByRole("combobox", { name: "Card language", exact: true }).selectOption(language);
    await expect(page.getByRole("combobox", { name: "Language", exact: true })).toHaveValue("en");
    await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue(offer);
    await expect(page.locator(".phone .offer-content")).toContainText(reward);
    await expect(page.locator(".phone-brand")).toHaveText("✦ Impact Vibes");
    await page.getByLabel("Message above card").fill("Custom message stays unchanged");
    await page.getByRole("combobox", { name: "Card language", exact: true }).selectOption("en");
    await expect(page.getByLabel("Message above card")).toHaveValue("Custom message stays unchanged");
    await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue("25% OFF");
    await page.getByRole("combobox", { name: "Card language", exact: true }).selectOption(language);
    const code = await page.locator('input[name="couponCode"]').inputValue();
    await page.screenshot({ path: info.outputPath(`card-language-${language}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    expect(await page.locator(".phone .scratch-card").evaluate((card) => {
      const bounds = card.getBoundingClientRect();
      return Array.from(card.querySelector(".offer-content").children).every((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right + 1
          && rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1;
      });
    })).toBe(true);
    await page.screenshot({ path: info.outputPath(`card-language-${language}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel("WhatsApp number", { exact: true }).fill("9876543210");
    await page.getByRole("button", { name: "Create scratch-card link" }).click();
    const share = page.getByRole("textbox", { name: "Share link", exact: true });
    await expect(share).toBeVisible();
    const url = await share.inputValue();
    await page.getByRole("button", { name: "Create another" }).click();
    await nav(page, "Coupons");
    await page.getByRole("row").filter({ hasText: code }).getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Scratch-card preview" });
    await expect(preview.locator(".offer-content")).toContainText(reward);
    await page.keyboard.press("Escape");
    const recipient = await context.newPage();
    await recipient.goto(url);
    await expect(recipient.locator(".recipient-topbar select")).toHaveCount(0);
    await expect(recipient.locator("main.recipient")).toHaveAttribute("lang", language);
    await expect(recipient.locator(".offer-content")).toContainText(reward);
    await expect(recipient.locator(".offer-content strong")).toHaveText(offer);
    await expect(recipient.locator(".recipient-brand")).toHaveText("✦ Impact Vibes");
    expect(await recipient.evaluate(() => localStorage.getItem("lucky-drop-language"))).toBe("en");
    await recipient.close();
  }
});

test("platform settings customize login and prefill new business limits", async ({ page }, info) => {
  await login(page, "platform@example.test", "Platform-Test-Password");
  await nav(page, "Platform settings");
  await page.getByLabel("Login welcome message").fill("Welcome to your rewards portal");
  await page.getByLabel("Support website", { exact: true }).fill("https://example.test/help");
  await page.getByLabel("Default scratch-card limit").fill("500");
  await page.getByLabel("Default department limit").fill("5");
  await page.getByLabel("Default branch limit").fill("4");
  await page.getByLabel("Default business account limit").fill("2");
  await page.getByRole("button", { name: "Save platform settings" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved successfully.");
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Platform settings");
  await expect(page.getByLabel("Default department limit")).toHaveValue("5");
  await expect(page.getByLabel("Default branch limit")).toHaveValue("4");
  await page.screenshot({ path: info.outputPath("platform-settings.png"), fullPage: true });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.screenshot({ path: info.outputPath("dark-platform-settings.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("switch", { name: "Dark mode" })).toBeVisible();
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav(page, "Businesses");
  await page.getByRole("button", { name: "Create business", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Scratch-card limit")).toHaveValue("500");
  await expect(dialog.getByLabel("Department limit", { exact: true })).toHaveValue("5");
  await expect(dialog.getByLabel("Business account limit")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Welcome to your rewards portal", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Visit support website" })).toHaveAttribute("href", "https://example.test/help");
});

test("business login stays scoped and mobile navigation fits the screen", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "owner@example.test", "Owner-Test-Password");
  await expect(page.locator(".p-welcome-row h1")).toHaveText(
    "Impact Vibes workspace",
  );
  await expect(page.locator(".p-sidebar nav button")).toHaveText([
    "Overview",
    "Create scratch card",
    "Campaigns",
    "Coupons",
    "Branches & Departments",
    "Department staff",
    "Business settings",
  ]);
  await page.getByRole("button", { name: "View all", exact: true }).click();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Coupons");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await nav(page, "Overview");
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-workspace.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".menu-open .p-sidebar")).toBeVisible();
  await nav(page, "Business settings");
  await expect(page.locator(".p-page-heading h1")).toHaveText("Business settings");
  await expect(page.getByLabel("Login ID")).toHaveValue("owner@example.test");
  await expect(page.getByLabel("Login ID")).toBeDisabled();
  await expect(page.getByText(/existing password cannot be recovered because it is protected/i)).toBeVisible();
  const businessNameSetting = page.getByLabel("Business name");
  await businessNameSetting.fill("Impact Vibes Rewards");
  await page.getByLabel("Website").fill("https://impact.example.test");
  await page.getByRole("button", { name: "Save business information" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved successfully.");
  await expect(businessNameSetting).toHaveValue("Impact Vibes Rewards");
  await businessNameSetting.fill("Impact Vibes");
  await page.getByLabel("Website").fill("");
  await page.getByRole("button", { name: "Save business information" }).click();
  await expect(businessNameSetting).toHaveValue("Impact Vibes");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  const passwordDialog = page.getByRole("dialog", { name: "Change your password" });
  await expect(passwordDialog.getByRole("textbox", { name: /^Current password/ })).toBeVisible();
  await expect(passwordDialog.getByRole("textbox", { name: /^New password/ })).toBeVisible();
  await passwordDialog.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await nav(page, "Create scratch card");
  await expect(
    page.getByRole("combobox", { name: "Department", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-builder.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Create scratch card");
});

test("business languages translate the whole workspace without changing cards or super admin", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "owner@example.test", "Owner-Test-Password");
  const languagePicker = page.locator(".p-topbar select");
  for (const locale of [
    { code: "hi", nav: ["अवलोकन", "स्क्रैच कार्ड बनाएँ", "अभियान", "कूपन", "शाखा & विभाग", "विभाग स्टाफ", "व्यवसाय सेटिंग्स"],
      workspace: "Impact Vibes कार्यक्षेत्र", available: "उपलब्ध इनाम", signOut: "साइन आउट",
      cardLanguage: "कार्ड की भाषा", campaign: "अभियान का नाम", branch: "विभाग", allBranches: "सभी विभाग",
      preview: "पूर्वावलोकन", previewTitle: "स्क्रैच-कार्ड पूर्वावलोकन", closePreview: "पूर्वावलोकन बंद करें",
      add: "विभाग जोड़ें", branchName: "विभाग का नाम", address: "पता", save: "बदलाव सहेजें", cancel: "रद्द करें",
      branchError: "विभाग का नाम ज़रूरी है।", edit: "संपादित करें", editTitle: "विभाग संपादित करें",
      success: "बदलाव सफलतापूर्वक सहेजे गए।", empty: "कोई रिकॉर्ड नहीं मिला", header: "इनाम और कूपन", exportHeader: "कूपन कोड" },
    { code: "te", nav: ["అవలోకనం", "స్క్రాచ్ కార్డ్ సృష్టించండి", "ప్రచారాలు", "కూపన్లు", "శాఖలు & విభాగాలు", "విభాగం సిబ్బంది", "వ్యాపార సెట్టింగ్‌లు"],
      workspace: "Impact Vibes కార్యస్థలం", available: "అందుబాటులో ఉన్న బహుమతులు", signOut: "సైన్ అవుట్",
      cardLanguage: "కార్డ్ భాష", campaign: "ప్రచారం పేరు", branch: "విభాగం", allBranches: "అన్ని విభాగాలు",
      preview: "ప్రివ్యూ", previewTitle: "స్క్రాచ్ కార్డ్ ప్రివ్యూ", closePreview: "ప్రివ్యూను మూసివేయండి",
      add: "విభాగాన్ని జోడించండి", branchName: "విభాగం పేరు", address: "చిరునామా", save: "మార్పులను సేవ్ చేయండి", cancel: "రద్దు చేయండి",
      branchError: "విభాగం పేరు అవసరం.", edit: "సవరించండి", editTitle: "విభాగాన్ని సవరించండి",
      success: "మార్పులు విజయవంతంగా సేవ్ అయ్యాయి.", empty: "రికార్డులు కనబడలేదు", header: "బహుమతి మరియు కూపన్", exportHeader: "కూపన్ కోడ్" },
  ]) {
    await languagePicker.selectOption(locale.code);
    await expect(page.locator(".p-sidebar nav button")).toHaveText(locale.nav);
    await expect(page.locator(".p-welcome-row h1")).toHaveText(locale.workspace);
    await expect(page.locator(".p-metrics")).toContainText(locale.available);
    await expect(page.locator(".p-topbar").getByRole("button", { name: locale.signOut })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale.code);
    await page.screenshot({ path: info.outputPath(`business-${locale.code}-overview.png`), fullPage: true });

    await nav(page, locale.nav[1]);
    await page.getByLabel(locale.campaign, { exact: true }).fill("Custom campaign unchanged");
    await expect(page.getByRole("combobox", { name: locale.branch, exact: true })).toContainText(locale.allBranches);
    await expect(page.locator(".phone-brand")).toHaveText("✦ Impact Vibes");
    // UI language must not change an English draft or its card-only selector.
    await expect(page.getByRole("combobox", { name: locale.cardLanguage, exact: true })).toHaveValue("en");
    await expect(page.locator(".phone h2")).toHaveText("A little surprise for you");
    await expect(page.locator(".offer-branch")).toHaveText("All departments");
    await page.getByRole("combobox", { name: locale.cardLanguage, exact: true }).selectOption("hi");
    await languagePicker.selectOption("en");
    await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue("Custom campaign unchanged");
    await expect(page.getByRole("combobox", { name: "Card language", exact: true })).toHaveValue("hi");
    await expect(page.locator(".phone h2")).toHaveText("आपके लिए एक छोटा सा सरप्राइज़");
    await languagePicker.selectOption(locale.code);
    await expect(page.locator(".phone h2")).toHaveText("आपके लिए एक छोटा सा सरप्राइज़");

    await nav(page, locale.nav[2]);
    await expect(page.locator(".p-page-heading h1")).toHaveText(locale.nav[2]);
    await expect(page.locator(".p-info")).not.toContainText("Set a campaign name");
    await expect(page.getByRole("cell", { name: "Diwali rewards", exact: true })).toBeVisible();

    await nav(page, locale.nav[3]);
    await expect(page.getByRole("columnheader", { name: locale.header, exact: true })).toBeVisible();
    await page.locator(".p-search input").fill("no-matching-record-123");
    await expect(page.locator(".p-empty b")).toHaveText(locale.empty);
    await page.locator(".p-search input").fill("");
    const row = page.getByRole("row").filter({ hasText: "Diwali rewards" });
    await row.getByRole("button", { name: locale.preview, exact: true }).click();
    const preview = page.getByRole("dialog", { name: locale.previewTitle });
    await expect(preview.locator(".p-reward-preview")).toHaveAttribute("lang", "en");
    await expect(preview.locator(".p-reward-preview h2")).toHaveText("A little surprise for you");
    await preview.getByRole("button", { name: locale.closePreview, exact: true }).last().click();
    const pending = page.waitForEvent("download");
    await page.locator(".p-toolbar .p-button").click();
    const download = await pending;
    expect(download.suggestedFilename()).toContain(`coupons-${locale.code}`);
    const archive = unzipSync(await fs.readFile(await download.path()));
    const workbookText = Object.values(archive).map((value) => strFromU8(value)).join(" ");
    expect(workbookText).toContain(locale.exportHeader);
    expect(workbookText).toContain("25% OFF");
    await page.reload();
    await expect(page.locator(".p-page-heading h1")).toHaveText(locale.nav[3]);
    await expect(languagePicker).toHaveValue(locale.code);

    await nav(page, locale.nav[4]);
    await page.getByRole("button", { name: locale.add, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(locale.branchName, { exact: true }).fill(" ");
    await dialog.getByRole("button", { name: locale.save, exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(locale.branchError);
    await dialog.getByRole("button", { name: locale.cancel, exact: true }).click();
    await expandBranchGroups(page);
    await page.getByRole("row").filter({ hasText: "Hyderabad" }).getByRole("button", { name: locale.edit, exact: true }).click();
    await expect(dialog).toHaveAccessibleName(locale.editTitle);
    await expect(dialog.getByLabel(locale.branchName, { exact: true })).toHaveValue("Hyderabad");
    await expect(dialog.getByLabel(locale.address, { exact: true })).toHaveValue("Jubilee Hills");
    await dialog.getByRole("button", { name: locale.save, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("status")).toContainText(locale.success);
    await page.screenshot({ path: info.outputPath(`business-${locale.code}-branches.png`), fullPage: true });
    await nav(page, locale.nav[0]);
  }
  // An English export remains available when the workspace is switched back.
  await languagePicker.selectOption("en");
  await nav(page, "Coupons");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  expect((await pending).suggestedFilename()).toContain("coupons-en");
  await languagePicker.selectOption("hi");
  await page.locator(".p-topbar button").last().click();
  await login(page, "platform@example.test", "Platform-Test-Password");
  await expect(page.locator(".p-topbar select")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".p-welcome-row h1")).toHaveText("Your rewards platform, at a glance.");
  await page.reload();
  await expect(page.locator(".p-sidebar nav button").first()).toHaveText("Overview");
  await nav(page, "Businesses");
  await page.getByRole("row").filter({ hasText: "Impact Vibes" }).getByRole("button", { name: "Open workspace" }).click();
  await expect(page.locator(".p-topbar select")).toHaveValue("hi");
  await expect(page.locator(".p-sidebar nav button").first()).toHaveText("अवलोकन");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await nav(page, "स्क्रैच कार्ड बनाएँ");
  await expect(page.getByRole("combobox", { name: "कार्ड की भाषा", exact: true })).toBeVisible();
  await languagePicker.selectOption("te");
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("స్క్రాచ్ కార్డ్ సృష్టించండి");
  await expect(languagePicker).toHaveValue("te");
  await expect(page.locator("html")).toHaveAttribute("lang", "te");
  await page.getByRole("button", { name: "Return to super admin" }).click();
  await expect(page.locator(".p-topbar select")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".p-sidebar nav button").first()).toHaveText("Overview");

  // A newly created business gets the same workspace control, not just Impact Vibes.
  await nav(page, "Businesses");
  await page.getByRole("button", { name: "Create business", exact: true }).click();
  const businessDialog = page.getByRole("dialog");
  await businessDialog.getByLabel("Business name").fill("Language Test Retail");
  await businessDialog.getByLabel("Password", { exact: true }).fill("LANGUAGEPASS58");
  await businessDialog.getByLabel("Confirm password", { exact: true }).fill("LANGUAGEPASS58");
  await businessDialog.getByRole("button", { name: "Save changes", exact: true }).click();
  const languageCredentials = await createdCredentials(page);
  await expect(businessDialog).not.toBeVisible();
  await page.getByRole("row").filter({ hasText: "Language Test Retail" }).getByRole("button", { name: "Open workspace" }).click();
  await expect(languagePicker).toHaveValue("te");
  await expect(page.locator(".p-welcome-row h1")).toHaveText("Language Test Retail కార్యస్థలం");
  await languagePicker.selectOption("en");
  await expect(page.locator(".p-welcome-row h1")).toHaveText("Language Test Retail workspace");
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out" }).click();
  await login(page, languageCredentials.loginId, languageCredentials.password);
  await expect(languagePicker).toHaveValue("en");
  await languagePicker.selectOption("hi");
  await expect(page.locator(".p-welcome-row h1")).toHaveText("Language Test Retail कार्यक्षेत्र");
  expect(errors).toEqual([]);
});

test("manual passwords and generated login IDs work for business and super-admin accounts", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page, "platform@example.test", "Platform-Test-Password");
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await nav(page, "Businesses");
  await page.getByRole("button", { name: "Create business", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Create business workspace" });
  await expect(editor.getByRole("textbox", { name: "Owner login email" })).toHaveCount(0);
  await expect(editor.locator('input[type="password"]')).toHaveCount(2);
  await editor.getByLabel("Business name", { exact: true }).fill("Credentials Test Shop");
  await expect(editor.getByLabel("Login ID (optional)")).toHaveValue("");
  await editor.getByLabel("Password", { exact: true }).fill("my simple password!");
  await editor.getByLabel("Confirm password", { exact: true }).fill("my simple password!");
  await editor.getByRole("button", { name: "Show Password", exact: true }).click();
  await expect(editor.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await expect(editor.getByLabel("Password", { exact: true })).toHaveValue("my simple password!");
  await editor.getByRole("button", { name: "Hide Password", exact: true }).click();
  await expect(editor.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Login credentials", exact: true });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Credentials Test Shop");
  await expect(popup).toContainText("password is shown only once");
  await expect(popup).toHaveCSS("width", "480px");
  await expect(popup).toHaveCSS("background-color", "rgb(27, 35, 50)");
  const credentials = {
    loginId: await popup.getByLabel("Login ID", { exact: true }).inputValue(),
    password: await popup.getByLabel("Password", { exact: true }).inputValue(),
  };
  expect(credentials.loginId).toMatch(/^(?=.*[A-Z])(?=.*\d)[A-Z\d]{12}$/);
  expect(credentials.password).toBe("my simple password!");
  await expect(popup.getByLabel("Login ID", { exact: true })).toHaveAttribute("readonly", "");
  for (const [key, label] of [["loginId", "Login ID"], ["password", "Password"]]) {
    await popup.getByRole("button", { name: `Copy ${label}`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(credentials[key]);
  }
  await popup.getByRole("button", { name: "Copy credentials", exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(`Login ID: ${credentials.loginId}\nPassword: ${credentials.password}`);
  await page.screenshot({ path: info.outputPath("generated-credentials-dark.png"), mask: [popup.getByLabel("Password", { exact: true })] });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await popup.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath("generated-credentials-mobile.png"), mask: [popup.getByLabel("Password", { exact: true })] });
  await page.keyboard.press("Escape");
  await expect(popup).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Businesses");
  await expect(popup).toHaveCount(0);
  const persisted = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(persisted).not.toContain(credentials.password);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out" }).click();
  await login(page, credentials.loginId, credentials.password);
  await expect(page.locator(".p-workspace-chip b")).toHaveText("Credentials Test Shop");
  await expect(page.locator(".p-sidebar nav").getByRole("button", { name: "Super admins", exact: true })).toHaveCount(0);
  await page.locator(".p-topbar button").last().click();
  await login(page, "platform@example.test", "Platform-Test-Password");
  await nav(page, "Super admins");
  await page.getByRole("button", { name: "Create super admin", exact: true }).click();
  const adminDialog = page.getByRole("dialog");
  await adminDialog.getByLabel("Full name", { exact: true }).fill("Credentials Test Admin");
  await adminDialog.getByLabel("Password", { exact: true }).fill("admin @ 2026");
  await adminDialog.getByLabel("Confirm password", { exact: true }).fill("admin @ 2026");
  await adminDialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Credentials Test Admin");
  const adminCredentials = await createdCredentials(page);
  expect(adminCredentials.password).toBe("admin @ 2026");
  expect(adminCredentials.loginId).not.toBe(credentials.loginId);
  expect(adminCredentials.password).not.toBe(credentials.password);
  await expect(page.getByRole("row").filter({ hasText: "Credentials Test Admin" })).toContainText(adminCredentials.loginId);
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out" }).click();
  await login(page, adminCredentials.loginId, adminCredentials.password);
  await expect(page.locator(".p-welcome-row h1")).toHaveText("Your rewards platform, at a glance.");
  await expect(page.locator(".p-sidebar nav").getByRole("button", { name: "Super admins", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".p-welcome-row h1")).toBeVisible();
  await nav(page, "Security");
  await expect(page.getByText(/does not delete accounts, change passwords, or remove business data/i)).toBeVisible();
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  const changePassword = page.getByRole("dialog", { name: "Change your password" });
  await changePassword.getByLabel("Current password", { exact: true }).fill("admin @ 2026");
  await changePassword.getByLabel("New password", { exact: true }).fill("admin changed @ 2026");
  await changePassword.getByLabel("Confirm new password", { exact: true }).fill("admin changed @ 2026");
  await changePassword.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(changePassword).not.toBeVisible();
  const protectedAdminPassword = page.getByLabel("Password", { exact: true });
  await expect(protectedAdminPassword).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(protectedAdminPassword).toHaveAttribute("type", "text");
  await expect(protectedAdminPassword).toHaveValue("admin changed @ 2026");
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain("admin changed @ 2026");
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Security");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("protected-password");
  await nav(page, "Super admins");
  await expect(page.getByRole("row").filter({ hasText: "Credentials Test Admin" }).getByRole("button", { name: "Pause" })).toHaveCount(0);
});

const responsiveSizes = [
  [320, 568], [360, 640], [390, 844], [430, 932], [600, 960],
  [768, 1024], [820, 1180], [844, 390], [1024, 768], [1440, 900], [1920, 1080],
];
const expectResponsiveFit = async (page) => {
  await expect.poll(() => page.evaluate(() => ({
    pageFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
    topbarFits: !document.querySelector(".p-topbar") || document.querySelector(".p-topbar").scrollWidth <= document.querySelector(".p-topbar").clientWidth + 1,
  }))).toEqual({ pageFits: true, topbarFits: true });
};

test("super admin pages and workspace dialogs align across phone, tablet and desktop sizes", async ({ page }, info) => {
  test.setTimeout(120000);
  for (const [width, height] of responsiveSizes) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator(".p-login")).toBeVisible();
    await expectResponsiveFit(page);
    if ([320, 768, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`responsive-login-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "platform@example.test", "Platform-Test-Password");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of responsiveSizes) {
    await page.setViewportSize({ width, height });
    for (const tab of ["Overview", "Businesses", "Scratch cards", "Security", "Platform settings"]) {
      await page.goto(`/?tab=${encodeURIComponent(tab)}`);
      await expect(page.locator(".p-loading")).toHaveCount(0);
      await expect(page.locator(".p-shell")).toBeVisible();
      await expectResponsiveFit(page);
      if (width <= 600) {
        for (const table of await page.locator(".p-table-scroll").all()) {
          expect(await table.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        }
      }
    }
    await page.goto("/?tab=Businesses");
    await page.getByRole("button", { name: "Create business", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0
        && rect.bottom <= innerHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    })).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("switch", { name: "Dark mode" }).click();
    await expectResponsiveFit(page);
    await expect(page.locator(".p-topbar .p-button")).toHaveCSS("background-color", "rgb(36, 46, 65)");
    if ([320, 768, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`responsive-admin-${width}.png`), fullPage: true });
    await page.getByRole("switch", { name: "Dark mode" }).click();
  }
  await page.setViewportSize({ width: 320, height: 568 });
  const toggle = page.getByRole("button", { name: "Open navigation", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".p-main")).toHaveAttribute("inert", "");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.locator(".p-sidebar nav button").last().focus();
  await page.keyboard.press("Tab");
  expect(await page.locator(".p-sidebar").evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".p-sidebar")).toHaveAttribute("inert", "");
  await toggle.click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".p-shell")).not.toHaveClass(/menu-open/);
  await expect(page.locator(".p-sidebar")).not.toHaveAttribute("inert", "");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("business forms, multilingual previews and public cards fit narrow and landscape screens", async ({ page }, info) => {
  test.setTimeout(120000);
  await login(page, "owner@example.test", "Owner-Test-Password");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const authResponse = await page.request.post("/api/auth/login", { data: { loginId: "owner@example.test", password: "Owner-Test-Password" } });
  const auth = await authResponse.json();
  const cardsResponse = await page.request.get("/api/portal/cards", { headers: { Authorization: `Bearer ${auth.token}` } });
  const { cards } = await cardsResponse.json();
  const publicCard = cards.find(card => !card.used && !card.disabled && !card.expiresAt);
  expect(publicCard).toBeTruthy();
  for (const [width, height] of responsiveSizes) {
    await page.setViewportSize({ width, height });
    await page.goto("/?tab=Overview");
    await expect(page.locator(".p-welcome-row")).toBeVisible();
    await expectResponsiveFit(page);
    await page.goto("/?tab=Create%20scratch%20card");
    await expect(page.getByLabel("Campaign name")).toBeVisible();
    await page.getByLabel("Message above card", { exact: true }).fill("A special celebration reward for you and your family on your next visit");
    await page.getByLabel("Main offer", { exact: true }).fill("50% OFF ON EVERY ORDER");
    await page.getByLabel("Offer details", { exact: true }).fill("Celebrate with this reward at your favourite neighbourhood branch");
    await expectResponsiveFit(page);
    expect(await page.locator(".phone").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    if ([320, 768, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`responsive-builder-${width}.png`), fullPage: true });
    await page.goto("/?tab=Coupons");
    const preview = page.getByRole("button", { name: "Preview", exact: true }).first();
    await expect(preview).toBeVisible();
    await preview.click();
    const dialog = page.getByRole("dialog", { name: "Scratch-card preview" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await dialog.getByLabel("Close preview", { exact: true }).click();
    await expectResponsiveFit(page);
    await page.goto(`/card/${publicCard.slug}`);
    await expect(page.locator(".recipient .scratch-card")).toBeVisible();
    await expectResponsiveFit(page);
    expect(await page.locator(".experience").evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth + 1;
    })).toBe(true);
    if ([320, 768].includes(width)) await page.screenshot({ path: info.outputPath(`responsive-public-card-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  for (const language of ["hi", "te", "en"]) {
    await page.goto("/?tab=Create%20scratch%20card");
    await page.locator(".p-topbar select").selectOption(language);
    await page.getByRole("combobox", { name: /Card language|कार्ड की भाषा|కార్డ్ భాష/ }).selectOption(language);
    await expectResponsiveFit(page);
  }
});

test("customer phones stay private while campaigns report cards by branch", async ({ page, context }, info) => {
  await login(page, "owner@example.test", "Owner-Test-Password");
  const authResponse = await page.request.post("/api/auth/login", {
    data: { loginId: "owner@example.test", password: "Owner-Test-Password" },
  });
  const { token } = await authResponse.json();
  const headers = { Authorization: `Bearer ${token}` };
  const businessesResponse = await page.request.get("/api/portal/businesses", { headers });
  const { businesses } = await businessesResponse.json();
  let branch = (businesses[0].branches || []).find(item => item.name === "Hyderabad");
  if (!branch) {
    const branchResponse = await page.request.post("/api/portal/businesses/impact-vibes/branches", {
      headers, data: { name: "Hyderabad", address: "Test branch" },
    });
    expect(branchResponse.status()).toBe(201);
    branch = (await branchResponse.json()).branch;
    await page.reload();
    await expect(page.locator(".p-welcome-row")).toBeVisible();
  }
  await nav(page, "Campaigns");
  await page.getByRole("button", { name: "Create scratch card", exact: true }).last().click();
  await page.getByLabel("Campaign name").fill("Branch reporting test");
  await page.getByRole("combobox", { name: "Department", exact: true }).selectOption(branch.branchId);
  await page.getByLabel("WhatsApp number", { exact: true }).fill("+91 (98765) 43210");
  await expect(page.locator(".phone")).not.toContainText("98765");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("private-phone-creator.png"), fullPage: true });
  await page.getByRole("button", { name: "Create scratch-card link" }).click();
  const shareUrl = await page.getByRole("textbox", { name: "Share link", exact: true }).inputValue();
  const slug = new URL(shareUrl).pathname.split("/").at(-1);
  await page.getByRole("button", { name: "Create another" }).click();
  await expect(page.getByLabel("WhatsApp number", { exact: true })).toHaveValue("");
  for (const branchId of [branch.branchId, ""]) {
    const result = await page.request.post("/api/cards", { headers, data: {
      businessId: "impact-vibes", branchId, campaignName: "Branch reporting test",
      headline: "A branch reward", offerTitle: "25% OFF", description: "Your next visit",
      customerPhone: "+919876543211",
    } });
    expect(result.status()).toBe(201);
  }
  await nav(page, "Coupons");
  const phoneRow = page.getByRole("row").filter({ hasText: "Branch reporting test" }).filter({ hasText: "+919876543210" });
  await expect(phoneRow).toContainText("Branch reporting test");
  await page.reload();
  await expect(phoneRow).toBeVisible();
  await phoneRow.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Scratch-card preview" });
  await expect(preview).not.toContainText("98765");
  await preview.getByLabel("Close preview", { exact: true }).click();
  const publicPage = await context.newPage();
  await publicPage.goto(shareUrl);
  await expect(publicPage.locator(".recipient .scratch-card")).toBeVisible();
  await expect(publicPage.locator("body")).not.toContainText("98765");
  const publicResponse = await page.request.get(`/api/cards/${slug}`);
  expect(await publicResponse.text()).not.toContain("customerPhone");
  const claimResponse = await page.request.post(`/api/cards/${slug}/claim`, { data: {} });
  expect(claimResponse.status()).toBe(200);
  expect(await claimResponse.text()).not.toContain("98765");
  const redemption = await page.request.post(`/api/portal/cards/${slug}/redeem`, { headers, data: { branchId: branch.branchId } });
  expect(redemption.status()).toBe(410);
  await publicPage.close();
  await nav(page, "Campaigns");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  const campaignRows = page.getByRole("row").filter({ hasText: "Branch reporting test" });
  await expect(campaignRows).toHaveCount(2);
  const assignedRow = campaignRows.filter({ hasText: "Hyderabad" });
  await expect(assignedRow.locator('[data-label="Scratch cards"]')).toHaveText("2");
  await expect(assignedRow.locator('[data-label="Redeemed"]')).toHaveText("0");
  await expect(campaignRows.filter({ hasText: "All departments" }).locator('[data-label="Scratch cards"]')).toHaveText("1");
  const cardsResponse = await page.request.get("/api/portal/cards", { headers });
  const { cards } = await cardsResponse.json();
  await expect(page.locator(".p-metrics strong")).toHaveText(String(cards.length));
  await page.getByLabel("Search Campaigns", { exact: true }).fill("Hyderabad");
  await expect(campaignRows).toHaveCount(1);
  await page.getByLabel("Search Campaigns", { exact: true }).fill("");
  await page.getByLabel("Search Campaigns", { exact: true }).fill("Branch reporting test");
  for (const language of ["en", "hi", "te"]) {
    await page.locator(".p-topbar select").selectOption(language);
    const pending = page.waitForEvent("download");
    await page.locator(".p-toolbar .p-button").click();
    const download = await pending;
    expect(download.suggestedFilename()).toContain(`campaigns-${language}`);
    const archive = unzipSync(await fs.readFile(await download.path()));
    const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const workbookText = Object.values(archive).map(value => strFromU8(value)).join(" ");
    expect(workbookText).toContain("Branch reporting test");
    expect(workbookText).toContain("Hyderabad");
    expect(workbookText).not.toContain("Diwali rewards");
    expect((sheet.match(/<row\b/g) || []).length).toBe(3);
    expect(sheet).toMatch(/<v>2<\/v>/);
  }
  await page.locator(".p-topbar select").selectOption("en");
  await page.getByLabel("Search Campaigns", { exact: true }).fill("");
  await page.screenshot({ path: info.outputPath("campaign-branch-counts.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("campaign-branches-mobile.png"), fullPage: true });
  await page.goto("/?tab=Coupons");
  await expect(phoneRow).toBeVisible();
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("private-phone-coupons-mobile.png"), fullPage: true });
});

test("mandatory WhatsApp creation, direct send, popup recovery and coupon expiry work", async ({ page }, info) => {
  await login(page, "owner@example.test", "Owner-Test-Password");
  await nav(page, "Create scratch card");
  const whatsappInput = page.getByLabel("WhatsApp number", { exact: true });
  const createRequests = [], createBodies = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/cards") {
      createRequests.push(request.url());
      createBodies.push(request.postDataJSON());
    }
  });
  await expect(whatsappInput).toHaveAttribute("required", "");
  await page.getByRole("button", { name: "Create scratch-card link" }).click();
  await expect(whatsappInput).toBeFocused();
  expect(await whatsappInput.evaluate(input => input.validity.valueMissing)).toBe(true);
  expect(createRequests).toHaveLength(0);
  await page.evaluate(() => {
    window.__whatsappCalls = [];
    window.open = (url, target, features) => {
      window.__whatsappCalls.push({ action: "open", url, target, features });
      return { closed: false, opener: null,
        location: { replace: url => window.__whatsappCalls.push({ action: "navigate", url }) },
        close: () => window.__whatsappCalls.push({ action: "close" }),
      };
    };
  });
  await whatsappInput.fill("invalid-number");
  await page.getByRole("button", { name: "Direct send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a valid WhatsApp number");
  expect(createRequests).toHaveLength(0);
  expect(await page.evaluate(() => window.__whatsappCalls)).toEqual([]);
  await whatsappInput.fill("+44 7700 900123");
  await page.getByLabel("Campaign name").fill("Direct send test");
  const expiryInput = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  await page.getByLabel("Expiry date (optional)").fill(expiryInput);
  await page.route("**/api/cards", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Test API unavailable" }) }));
  await page.getByRole("button", { name: "Direct send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Test API unavailable");
  expect(await page.evaluate(() => window.__whatsappCalls.map(call => call.action))).toEqual(["open", "close"]);
  await page.unroute("**/api/cards");
  await page.evaluate(() => window.__whatsappCalls = []);
  await page.getByRole("button", { name: "Direct send", exact: true }).click();
  const shareLink = page.getByRole("textbox", { name: "Share link", exact: true });
  await expect(shareLink).toBeVisible();
  const url = await shareLink.inputValue();
  const calls = await page.evaluate(() => window.__whatsappCalls);
  expect(calls[0].url).toBe("about:blank");
  const whatsappUrl = new URL(calls.find(call => call.action === "navigate").url);
  expect(whatsappUrl.origin).toBe("https://web.whatsapp.com");
  expect(whatsappUrl.pathname).toBe("/send");
  expect(whatsappUrl.searchParams.get("phone")).toBe("447700900123");
  expect(whatsappUrl.searchParams.get("text")).toContain(url);
  await page.getByRole("button", { name: "Open WhatsApp Web", exact: true }).click();
  expect((await page.evaluate(() => window.__whatsappCalls)).at(-1).url).toBe(whatsappUrl.href);
  await page.getByRole("button", { name: "Create another" }).click();
  await expect(whatsappInput).toHaveValue("");
  await page.evaluate(() => {
    window.__whatsappCalls = [];
  });
  const imageInput = page.getByLabel("WhatsApp image");
  await imageInput.setInputFiles({
    name: "festival-offer.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByAltText("WhatsApp share preview")).toBeVisible();
  await expect(page.getByText("festival-offer.png", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("direct-send-image-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await whatsappInput.fill("9876543213");
  await page.getByRole("button", { name: "Direct send", exact: true }).click();
  await expect(shareLink).toBeVisible();
  expect(createBodies.at(-1).shareImage).toMatch(/^data:image\/png;base64,/);
  const imageWhatsAppCalls = await page.evaluate(() => window.__whatsappCalls);
  expect(imageWhatsAppCalls.map(call => call.action)).toEqual(["open", "navigate"]);
  const imageWhatsAppUrl = new URL(imageWhatsAppCalls[1].url);
  expect(imageWhatsAppUrl.origin).toBe("https://web.whatsapp.com");
  expect(imageWhatsAppUrl.searchParams.get("phone")).toBe("919876543213");
  expect(imageWhatsAppUrl.searchParams.get("text")).toContain(await shareLink.inputValue());
  await expect(page.locator(".modal .copied")).toContainText("preview-enabled link");
  await expect(page.getByRole("button", { name: "Open WhatsApp Web", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download image", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Create another" }).click();
  await expect(imageInput).toHaveValue("");
  await expect(page.getByAltText("WhatsApp share preview")).toHaveCount(0);
  await page.evaluate(() => { window.open = () => null; });
  await whatsappInput.fill("9876543212");
  await page.getByLabel("Expiry date (optional)").fill("");
  await page.getByRole("button", { name: "Direct send", exact: true }).click();
  await expect(shareLink).toBeVisible();
  await expect(page.locator(".modal .copied")).toContainText("WhatsApp Web could not open");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(shareLink).toHaveCount(0);
  await nav(page, "Coupons");
  const expiringRow = page.getByRole("row").filter({ hasText: "+447700900123" });
  await expect(expiringRow.locator('[data-label="Expiry date"]')).not.toHaveText("No expiry");
  await expect(expiringRow.locator('[data-label="Expiry date"]')).toContainText(String(new Date(expiryInput).getFullYear()));
  const noExpiryRow = page.getByRole("row").filter({ hasText: "+919876543212" });
  await expect(noExpiryRow.locator('[data-label="Expiry date"]')).toHaveText("No expiry");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  const download = await downloadPromise;
  const archive = unzipSync(await fs.readFile(await download.path()));
  const text = Object.values(archive).map(value => strFromU8(value)).join(" ");
  expect(text).toContain("Expiry date");
  expect(text).toContain("WhatsApp number");
  expect(text).toContain("+447700900123");
  await page.setViewportSize({ width: 320, height: 568 });
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("coupon-whatsapp-expiry-mobile.png"), fullPage: true });
  await page.goto("/?tab=Create%20scratch%20card");
  await expect(page.getByRole("button", { name: "Direct send", exact: true })).toBeVisible();
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("direct-send-mobile.png"), fullPage: true });
});

test("coupon filters combine numbers, branches, campaigns, custom dates and filtered exports", async ({ page }, info) => {
  await login(page, "owner@example.test", "Owner-Test-Password");
  const authResponse = await page.request.post("/api/auth/login", { data: { loginId: "owner@example.test", password: "Owner-Test-Password" } });
  const { token } = await authResponse.json();
  const headers = { Authorization: `Bearer ${token}` };
  const businessResponse = await page.request.get("/api/portal/businesses", { headers });
  const { businesses } = await businessResponse.json();
  const branchList = businesses[0].branches || [];
  for (const name of ["Filter North", "Filter South"]) {
    if (branchList.length >= 2) break;
    const response = await page.request.post("/api/portal/businesses/impact-vibes/branches", { headers, data: { name, address: "Filter test" } });
    expect(response.status()).toBe(201);
    branchList.push((await response.json()).branch);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const old = new Date(today); old.setDate(old.getDate() - 7);
  const endOfToday = new Date(today); endOfToday.setHours(23, 59, 59, 999);
  const samples = [
    { couponCode: "FILTER-TEST-A", branchId: branchList[0].branchId, campaignName: "Filter Campaign A", customerPhone: "+919876545001", createdAt: today.toISOString() },
    { couponCode: "FILTER-TEST-B", branchId: branchList[1].branchId, campaignName: "Filter Campaign A", customerPhone: "+919876545002", createdAt: endOfToday.toISOString() },
    { couponCode: "FILTER-TEST-C", branchId: branchList[0].branchId, campaignName: "Filter Campaign B", customerPhone: "+919876545003", createdAt: yesterday.toISOString() },
    { couponCode: "FILTER-TEST-D", branchId: "", campaignName: "", customerPhone: "+919876545004", createdAt: old.toISOString() },
  ];
  const createdDates = new Map();
  for (const { createdAt, ...sample } of samples) {
    const response = await page.request.post("/api/cards", { headers, data: {
      ...sample, businessId: "impact-vibes", headline: "Filter test reward", offerTitle: "25% OFF", description: "A test offer",
    } });
    expect(response.status()).toBe(201);
    const result = await response.json();
    createdDates.set(result.slug, createdAt);
    if (sample.couponCode === "FILTER-TEST-C") {
      expect((await page.request.post(`/api/cards/${result.slug}/claim`, { data: {} })).status()).toBe(200);
      expect((await page.request.post(`/api/portal/cards/${result.slug}/redeem`, { headers, data: { branchId: sample.branchId } })).status()).toBe(410);
    }
  }
  // Override creation dates only in the isolated fixture response to exercise historical ranges.
  await page.route("**/api/portal/cards*", async route => {
    const response = await route.fetch();
    const result = await response.json();
    result.cards = result.cards.map(card => createdDates.has(card.slug) ? { ...card, createdAt: createdDates.get(card.slug) } : card);
    await route.fulfill({ response, json: result });
  });
  await page.goto("/?tab=Coupons");
  const textSearch = page.getByLabel("Search Coupons", { exact: true });
  const numberSearch = page.getByLabel("Search WhatsApp number", { exact: true });
  const branchFilter = page.getByLabel("Filter by department", { exact: true });
  const campaignFilter = page.getByLabel("Filter by campaign", { exact: true });
  const dateFilter = page.getByLabel("Created date range", { exact: true });
  const sampleRows = page.getByRole("row").filter({ hasText: "FILTER-TEST-" });
  await expect(page.getByLabel("Coupon status", { exact: true }).locator('option[value="opened"]')).toHaveCount(1);
  await textSearch.fill("FILTER-TEST-");
  await expect(sampleRows).toHaveCount(4);
  await numberSearch.fill("5002");
  await expect(sampleRows).toHaveCount(1);
  await expect(sampleRows).toContainText("FILTER-TEST-B");
  await numberSearch.fill("");
  await branchFilter.selectOption({ label: branchList[0].name });
  await expect(sampleRows).toHaveCount(2);
  await campaignFilter.selectOption({ label: "Filter Campaign A" });
  await expect(sampleRows).toHaveCount(1);
  await dateFilter.selectOption("today");
  await numberSearch.fill("+91 (98765) 45001");
  await expect(sampleRows).toHaveCount(1);
  await expect(sampleRows).toContainText("FILTER-TEST-A");
  await page.getByLabel("Coupon status", { exact: true }).selectOption("redeemed");
  await expect(page.locator(".p-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export Excel", exact: true })).toBeDisabled();
  await page.getByLabel("Coupon status", { exact: true }).selectOption("all");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  const download = await pending;
  const archive = unzipSync(await fs.readFile(await download.path()));
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  const workbookText = Object.values(archive).map(value => strFromU8(value)).join(" ");
  expect((sheet.match(/<row\b/g) || []).length).toBe(2);
  expect(workbookText).toContain("FILTER-TEST-A");
  expect(workbookText).not.toContain("FILTER-TEST-B");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(sampleRows).toHaveCount(1);
  await expect(numberSearch).toHaveValue("+91 (98765) 45001");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(numberSearch).toHaveValue("");
  await expect(textSearch).toHaveValue("");
  await expect(branchFilter).toHaveValue("");
  await expect(campaignFilter).toHaveValue("");
  await expect(dateFilter).toHaveValue("all");
  await textSearch.fill("FILTER-TEST-");
  await campaignFilter.selectOption({ label: "Filter Campaign A" });
  await dateFilter.selectOption("today");
  await expect(sampleRows).toHaveCount(2);
  await dateFilter.selectOption("custom");
  const from = page.getByLabel("Created from", { exact: true });
  const to = page.getByLabel("Created to", { exact: true });
  await from.fill(dateKey(today));
  await to.fill(dateKey(today));
  await expect(sampleRows).toHaveCount(2); // Includes the last millisecond of the selected end date.
  await from.fill(dateKey(tomorrow));
  await expect(page.getByRole("alert")).toContainText("From date must be on or before To date.");
  await expect(page.getByRole("button", { name: "Export Excel", exact: true })).toBeDisabled();
  await from.fill(dateKey(yesterday));
  await to.fill(dateKey(yesterday));
  await campaignFilter.selectOption({ label: "Filter Campaign B" });
  await expect(sampleRows).toHaveCount(1);
  await expect(sampleRows).toContainText("FILTER-TEST-C");
  await campaignFilter.selectOption("");
  await dateFilter.selectOption("week");
  await expect(sampleRows).toHaveCount(3);
  await dateFilter.selectOption("month");
  await expect(sampleRows).toHaveCount(4);
  await dateFilter.selectOption("all");
  await branchFilter.selectOption("unassigned");
  await campaignFilter.selectOption({ label: "General rewards" });
  await expect(sampleRows).toHaveCount(1);
  await expect(sampleRows).toContainText("FILTER-TEST-D");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await textSearch.fill("FILTER-TEST-");
  await numberSearch.fill("5001");
  await dateFilter.selectOption("custom");
  await from.fill(dateKey(today));
  await to.fill(dateKey(today));
  await page.screenshot({ path: info.outputPath("coupon-filters-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await expectResponsiveFit(page);
  for (const language of ["hi", "te", "en"]) {
    await page.locator(".p-topbar select").selectOption(language);
    await expect(page.locator(".p-coupon-filters")).toContainText({ hi: "कूपन फ़िल्टर", te: "కూపన్ ఫిల్టర్లు", en: "Coupon filters" }[language]);
    await expectResponsiveFit(page);
  }
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.screenshot({ path: info.outputPath("coupon-filters-mobile-dark.png"), fullPage: true });
});

test("branch export matches searched rows in all languages and works for super admin", async ({ page }, info) => {
  await login(page, "owner@example.test", "Owner-Test-Password");
  const authResponse = await page.request.post("/api/auth/login", { data: { loginId: "owner@example.test", password: "Owner-Test-Password" } });
  const { token } = await authResponse.json();
  const headers = { Authorization: `Bearer ${token}` };
  const businessResponse = await page.request.get("/api/portal/businesses", { headers });
  const { businesses } = await businessResponse.json();
  const branchList = businesses[0].branches || [];
  for (const name of ["Export North", "Export South"]) {
    if (branchList.length >= 2) break;
    const response = await page.request.post("/api/portal/businesses/impact-vibes/branches", { headers, data: { name, address: `${name} address` } });
    expect(response.status()).toBe(201);
    branchList.push((await response.json()).branch);
  }
  await page.goto("/?tab=Branches");
  const search = page.getByLabel("Search Departments", { exact: true });
  await search.fill(branchList[0].name);
  const readWorkbook = async () => {
    const pending = page.waitForEvent("download");
    await page.locator(".p-toolbar .p-button").click();
    const download = await pending;
    const archive = unzipSync(await fs.readFile(await download.path()));
    return {
      filename: download.suggestedFilename(),
      sheet: strFromU8(archive["xl/worksheets/sheet1.xml"]),
      text: Object.values(archive).map(value => strFromU8(value)).join(" "),
    };
  };
  for (const [language, header] of [["en", "Address"], ["hi", "पता"], ["te", "చిరునామా"]]) {
    await page.locator(".p-topbar select").selectOption(language);
    const workbook = await readWorkbook();
    expect(workbook.filename).toContain(`departments-${language}`);
    expect(workbook.text).toContain(header);
    expect(workbook.text).toContain(branchList[0].name);
    expect(workbook.text).toContain(branchList[0].address);
    expect(workbook.text).not.toContain(branchList[1].name);
    expect((workbook.sheet.match(/<row\b/g) || []).length).toBe(2);
  }
  await page.locator(".p-topbar select").selectOption("en");
  await search.fill("no-matching-export-branch");
  await expect(page.getByRole("button", { name: "Export departments", exact: true })).toBeDisabled();
  await search.fill("");
  const allBranches = await readWorkbook();
  expect((allBranches.sheet.match(/<row\b/g) || []).length).toBe(branchList.length + 1);
  await page.setViewportSize({ width: 320, height: 568 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("branch-export-mobile.png"), fullPage: true });
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, "platform@example.test", "Platform-Test-Password");
  await nav(page, "Departments");
  await page.getByLabel("Search Departments", { exact: true }).fill(branchList[0].name);
  const visibleRows = await page.locator(".p-table-scroll tbody tr").count();
  const adminWorkbook = await readWorkbook();
  expect(adminWorkbook.filename).toContain("departments-en");
  expect(adminWorkbook.text).toContain("Impact Vibes");
  expect((adminWorkbook.sheet.match(/<row\b/g) || []).length).toBe(visibleRows + 1);
});

test("bulk creator recovers retries, marks scratches pending and exports every page", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const rootHeaders = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers: rootHeaders, data: { name: "Bulk Test Business", password: "BULKTESTPASS58", limits: { card: 75, branch: 3, account: 1 } } });
  expect(created.status()).toBe(201);
  const { business, credentials } = await created.json();
  const ownerLogin = await page.request.post("/api/auth/login", { data: credentials });
  const headers = { Authorization: `Bearer ${(await ownerLogin.json()).token}` };
  const branches = [];
  for (const name of ["Ameerpet", "Kukatpally", "Madhapur"]) {
    const response = await page.request.post(`/api/portal/businesses/${business.businessId}/branches`, { headers, data: { name } });
    expect(response.status()).toBe(201); branches.push((await response.json()).branch);
  }
  await login(page, credentials.loginId, credentials.password);
  await nav(page, "Create scratch card");
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toHaveValue("25");
  await expect(page.getByLabel("WhatsApp number", { exact: true })).not.toHaveAttribute("required", "");
  await page.getByRole("button", { name: "+ Add Department", exact: true }).click();
  await page.getByRole("button", { name: "+ Add Department", exact: true }).click();
  await expect(page.getByLabel("Bulk department 2").locator(`option[value="${branches[0].branchId}"]`)).toHaveAttribute("disabled", "");
  await expect(page.getByRole("button", { name: "Generate 75 Coupons", exact: true })).toBeEnabled();
  await expect(page.locator(".bulk-summary")).toContainText("Total: 75 coupons");
  await page.locator(".bulk-branch-row").nth(2).getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".phone .offer-branch")).toHaveText("Madhapur");
  await expect(page.locator(".phone-brand")).toContainText("Bulk Test Business");
  await page.getByLabel("Remove department row 3").click();
  await expect(page.getByRole("button", { name: "Generate 50 Coupons", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "+ Add Department", exact: true }).click();
  await page.locator('input[name="campaignName"]').fill("Bulk Summer");
  await page.locator('input[name="expiresAt"]').fill("2099-12-31T18:00");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("bulk-creator-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let committed;
  await page.route("**/api/cards/bulk", async (route) => {
    const response = await route.fetch();
    committed = await response.json();
    await route.abort("failed"); // Lost response after commit: the dangerous retry case.
  }, { times: 1 });
  await page.getByRole("button", { name: "Generate 75 Coupons", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry saved batch", exact: true })).toBeEnabled();
  expect(committed.savedCount).toBe(75);
  await page.reload();
  await expect(page.getByRole("button", { name: "Single Card", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry saved batch", exact: true })).toBeEnabled();
  const retryResponse = page.waitForResponse((response) => response.url().endsWith("/api/cards/bulk") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Retry saved batch", exact: true }).click();
  const retry = await (await retryResponse).json();
  expect(retry.replayed).toBe(true); expect(retry.savedCount).toBe(75);
  const results = page.getByRole("region", { name: "Generated batch results" });
  await expect(results).toBeVisible();
  await expect(results.locator("tbody tr")).toHaveCount(25);
  await expect(results.locator(".bulk-pagination")).toContainText("Page 1 of 3");
  await results.getByRole("button", { name: "Next", exact: true }).click();
  await expect(results.locator(".bulk-pagination")).toContainText("Page 2 of 3");
  await results.getByLabel("Filter batch by department").selectOption(branches[2].branchId);
  await expect(results.locator("tbody tr")).toHaveCount(25);
  await expect(results.locator("tbody tr").first()).toContainText("Madhapur");
  const downloadPromise = page.waitForEvent("download");
  await results.getByRole("button", { name: "Download Excel", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const archive = unzipSync(await fs.readFile(await download.path()));
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  expect((sheet.match(/<row\b/g) || []).length).toBe(76);
  const text = Object.values(archive).map((value) => strFromU8(value)).join(" ");
  for (const header of ["Department", "Coupon Code", "Main Offer", "Offer Details", "Campaign Name", "Scratch Link", "Expiry Date", "Status", "Created At"])
    expect(text).toContain(header);
  for (const card of committed.coupons) { expect(text).toContain(card.couponCode); expect(text).toContain(`/card/${card.slug}`); }
  expect(sheet).toMatch(/r="B2"[^>]*t="(?:s|inlineStr)"/);
  expect(sheet).toMatch(/r="F2"[^>]*t="(?:s|inlineStr)"/);
  await results.locator("tbody tr").first().getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(results.getByRole("status")).toContainText("copied");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("bulk-results-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const card = committed.coupons[0];
  await nav(page, "Coupons");
  const row = page.getByRole("row").filter({ hasText: card.couponCode });
  await expect(row.locator(".p-badge")).toHaveText("available");
  expect((await page.request.post(`/api/cards/${card.slug}/claim`, { data: {} })).status()).toBe(200);
  expect((await page.request.post(`/api/portal/cards/${card.slug}/redeem`, { headers, data: { branchId: branches[1].branchId } })).status()).toBe(410);
  // The list updates from server activity without reloading or clicking Refresh.
  await expect(row.locator(".p-badge")).toHaveText("scratched", { timeout: 20000 });
  await expect(row.getByRole("button", { name: "Redeem", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Coupon status").locator('option[value="scratched"]')).toHaveCount(1);
  await expect(row.locator(".p-badge")).toHaveText("scratched");
  expect((await page.request.get("/api/portal/cards", { headers })).ok()).toBe(true);
  const cards = (await (await page.request.get("/api/portal/cards", { headers })).json()).cards;
  expect(cards).toHaveLength(75);
  expect(cards.find((item) => item.slug === card.slug).redeemedBranchId || "").toBe("");
  await page.goto(`/card/${card.slug}`);
  await expect(page.locator(".scratch-card canvas")).toHaveCount(0);
  await expect(page.locator(".scratch-card .offer-content b")).toContainText(card.couponCode);
  await expect(page.getByRole("link", { name: "Create a new scratch card" })).toHaveCount(0);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coupons", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, { headers: rootHeaders, data: { confirmName: "Bulk Test Business" } })).status()).toBe(200);
});

test("batch WhatsApp sharing exports every coupon and opens one chat for manual Excel attachment", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const rootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const rootHeaders = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers: rootHeaders,
    data: { name: "Batch Excel Share Business", password: "BATCHEXCEL58", limits: { card: 40, branch: 2, account: 1 } } });
  expect(created.status()).toBe(201);
  const { business, credentials } = await created.json();
  const ownerLogin = await page.request.post("/api/auth/login", { data: credentials });
  const headers = { Authorization: `Bearer ${(await ownerLogin.json()).token}` };
  const branches = [];
  for (const name of ["Sales", "Service"]) {
    const response = await page.request.post(`/api/portal/businesses/${business.businessId}/branches`, { headers, data: { name } });
    expect(response.status()).toBe(201); branches.push((await response.json()).branch);
  }
  await login(page, credentials.loginId, credentials.password);
  await nav(page, "Create scratch card");
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import WhatsApp numbers from Excel", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Upload Excel numbers", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download Excel format", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("WhatsApp number", { exact: true })).not.toHaveAttribute("required", "");

  // Existing assigned batches and pending retries remain usable after removing the import UI.
  const draft = { businessId: business.businessId, language: "en", headline: "A surprise",
    offerTitle: "25% OFF", description: "Your next order", campaignName: "Batch Excel Share",
    expiresAt: "2099-12-31T18:00:00.000Z", idempotencyKey: "legacy-excel-share-batch-001",
    branches: branches.map(branch => ({ branchId: branch.branchId, quantity: 16 })),
    recipients: branches.flatMap((branch, branchIndex) => Array.from({ length: 16 }, (_, index) => ({
      branchId: branch.branchId, customerPhone: `+91987654${String(branchIndex * 16 + index + 1).padStart(4, "0")}`,
    }))),
  };
  const batchResponse = await page.request.post("/api/cards/bulk", { headers, data: draft });
  expect(batchResponse.status()).toBe(201);
  const batch = await batchResponse.json();
  expect(batch.savedCount).toBe(32);
  await page.evaluate(({ id, draft }) => sessionStorage.setItem(`scratch-bulk-pending:${id}`, JSON.stringify(draft)), { id: business.businessId, draft });
  await page.reload();
  await expect(page.getByRole("button", { name: "Single Card", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry saved batch", exact: true })).toBeEnabled();
  const retryResponse = page.waitForResponse(response => response.url().endsWith("/api/cards/bulk") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Retry saved batch", exact: true }).click();
  const retry = await (await retryResponse).json();
  expect(retry.replayed).toBe(true); expect(retry.savedCount).toBe(32);
  expect(retry.coupons.map(card => card.customerPhone)).toEqual(batch.coupons.map(card => card.customerPhone));
  const results = page.getByRole("region", { name: "Generated batch results" });
  await expect(results).toBeVisible();
  await expect(results.locator("tbody tr")).toHaveCount(25);
  await results.getByRole("button", { name: "Next", exact: true }).click();
  await expect(results.locator("tbody tr")).toHaveCount(7);
  await results.getByLabel("Filter batch by department").selectOption(branches[1].branchId);
  await expect(results.locator("tbody tr")).toHaveCount(16);
  await expect(results.getByRole("button", { name: "Send via WhatsApp", exact: true })).toBeEnabled();

  // Sharing reloads current server state, but neither exporting nor opening a chat redeems coupons.
  const firstCard = batch.coupons[0];
  const revealed = await (await page.request.post(`/api/cards/${firstCard.slug}/claim`, { data: {} })).json();
  expect(JSON.stringify(revealed)).not.toContain(firstCard.customerPhone);
  const savedBefore = (await (await page.request.get("/api/portal/cards", { headers })).json()).cards;
  const batchBefore = savedBefore.filter(card => batch.coupons.some(coupon => coupon.slug === card.slug));
  const downloads = [];
  page.on("download", download => downloads.push(download));
  const mockWindow = async (blocked = false) => page.evaluate(blocked => {
    window.__batchChatCalls = [];
    window.open = (url, target) => {
      window.__batchChatCalls.push({ action: "open", url, target });
      return blocked ? null : { closed: false, opener: null,
        location: { replace: url => window.__batchChatCalls.push({ action: "navigate", url }) },
        close: () => window.__batchChatCalls.push({ action: "close" }),
      };
    };
  }, blocked);
  const readWorkbook = async download => {
    const archive = unzipSync(await fs.readFile(await download.path()));
    const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const shared = archive["xl/sharedStrings.xml"] ? strFromU8(archive["xl/sharedStrings.xml"]) : "";
    const rows = await page.evaluate(({ sheet, shared }) => {
      const parser = new DOMParser();
      const strings = [...parser.parseFromString(shared || "<sst/>", "application/xml").querySelectorAll("si")]
        .map(element => [...element.querySelectorAll("t")].map(text => text.textContent).join(""));
      return [...parser.parseFromString(sheet, "application/xml").querySelectorAll("row")].map(row => {
        const values = Array(10).fill(null), types = Array(10).fill(null);
        for (const cell of row.querySelectorAll("c")) {
          const letters = cell.getAttribute("r").replace(/\d+/g, "");
          let column = 0; for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
          const type = cell.getAttribute("t"), raw = cell.querySelector("v")?.textContent;
          values[column - 1] = type === "s" ? strings[Number(raw)] : type === "inlineStr" ? cell.querySelector("t")?.textContent || "" : raw || "";
          types[column - 1] = type;
        }
        return { values, types };
      });
    }, { sheet, shared });
    return { rows, sheet };
  };
  await mockWindow();
  await results.getByRole("button", { name: "Send via WhatsApp", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Send batch Excel via WhatsApp Web", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Recipient WhatsApp number", { exact: true })).toHaveValue("");
  const submit = dialog.getByRole("button", { name: "Download Excel & open WhatsApp Web", exact: true });
  await expect(submit).toBeDisabled();
  const permission = dialog.getByLabel("I have permission to share these coupons and contact details with this number", { exact: true });
  await permission.check();
  await dialog.getByLabel("Recipient WhatsApp number", { exact: true }).fill("invalid-number");
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("valid WhatsApp number");
  expect(downloads).toHaveLength(0);
  expect(await page.evaluate(() => window.__batchChatCalls)).toEqual([]);

  await dialog.getByLabel("Recipient WhatsApp number", { exact: true }).fill("+44 7700 900123");
  const batchRoute = "**/api/portal/batches/**";
  await page.route(batchRoute, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Test batch unavailable" }) }), { times: 1 });
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("Test batch unavailable");
  expect(downloads).toHaveLength(0);
  expect(await page.evaluate(() => window.__batchChatCalls.map(call => call.action))).toEqual(["open", "close"]);
  await page.unroute(batchRoute);
  await mockWindow();
  // Hold the API response to assert that re-clicks, editing and closing are disabled during processing.
  let releaseBatch;
  let batchRequested;
  const requested = new Promise(resolve => { batchRequested = resolve; });
  await page.route(batchRoute, async route => {
    const response = await route.fetch();
    batchRequested();
    await new Promise(resolve => { releaseBatch = resolve; });
    await route.fulfill({ response });
  }, { times: 1 });
  const downloadPromise = page.waitForEvent("download");
  await submit.click();
  await requested;
  await expect(dialog.getByRole("button", { name: "Preparing Excel…", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Recipient WhatsApp number", { exact: true })).toBeDisabled();
  await expect(permission).toBeDisabled();
  for (const close of await dialog.getByRole("button", { name: /Close dialog|Cancel/ }).all()) await expect(close).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseBatch();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whatsapp-coupons-\d{4}-\d{2}-\d{2}\.xlsx$/);
  await expect(dialog.getByRole("status")).toContainText("32");
  const workbook = await readWorkbook(download);
  expect(workbook.rows).toHaveLength(33);
  const requiredHeaders = ["Department", "Coupon Code", "Main Offer", "Offer Details", "Campaign Name", "Scratch Link", "Expiry Date", "Status", "Created At", "WhatsApp Number"];
  expect(workbook.rows[0].values).toEqual(expect.arrayContaining(requiredHeaders));
  expect(workbook.rows[0].values.filter(Boolean)).toHaveLength(10);
  const headerIndex = Object.fromEntries(workbook.rows[0].values.map((header, index) => [header, index]));
  for (const card of batch.coupons) {
    const row = workbook.rows.find(row => row.values[headerIndex["Coupon Code"]] === card.couponCode);
    expect(row).toBeTruthy();
    expect(row.values[headerIndex.Department]).toBe(card.branchName);
    expect(row.values[headerIndex["WhatsApp Number"]]).toBe(card.customerPhone);
    expect(row.values[headerIndex["Scratch Link"]]).toBe(`http://127.0.0.1:5099/card/${card.slug}`);
    for (const name of ["Coupon Code", "Scratch Link", "WhatsApp Number"]) expect(row.types[headerIndex[name]]).toMatch(/^(s|inlineStr)$/);
  }
  expect(workbook.rows.find(row => row.values[headerIndex["Coupon Code"]] === firstCard.couponCode).values[headerIndex.Status].toLowerCase()).toBe("scratched");
  const calls = await page.evaluate(() => window.__batchChatCalls);
  expect(calls.map(call => call.action)).toEqual(["open", "navigate"]);
  expect(calls[0].url).toBe("about:blank");
  const url = new URL(calls[1].url);
  expect(url.origin).toBe("https://web.whatsapp.com"); expect(url.pathname).toBe("/send");
  expect(url.searchParams.get("phone")).toBe("447700900123");
  expect(url.searchParams.get("text")).toContain("32");
  expect(url.searchParams.get("text").toLowerCase()).toContain("excel");
  await expect(dialog).toContainText("This website cannot attach or send the file automatically.");
  expect(downloads).toHaveLength(1);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).last().click();
  await page.unroute(batchRoute);

  // A blocked popup still downloads the complete workbook, and the retry opens a chat without another file.
  await mockWindow(true);
  await results.getByRole("button", { name: "Send via WhatsApp", exact: true }).click();
  await expect(dialog.getByLabel("Recipient WhatsApp number", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Recipient WhatsApp number", { exact: true }).fill("9876543210");
  await permission.check();
  const blockedDownloadPromise = page.waitForEvent("download");
  await submit.click();
  await blockedDownloadPromise;
  await expect(dialog.getByRole("alert")).toContainText("blocked");
  await expect(dialog.getByRole("button", { name: "Open WhatsApp Web", exact: true })).toBeEnabled();
  expect(downloads).toHaveLength(2);
  await mockWindow();
  await dialog.getByRole("button", { name: "Open WhatsApp Web", exact: true }).click();
  const recoveryCalls = await page.evaluate(() => window.__batchChatCalls);
  expect(recoveryCalls.filter(call => call.action === "navigate")).toHaveLength(1);
  const recoveryUrl = new URL(recoveryCalls.find(call => call.action === "navigate").url);
  expect(recoveryUrl.origin).toBe("https://web.whatsapp.com");
  expect(recoveryUrl.pathname).toBe("/send");
  expect(recoveryUrl.searchParams.get("phone")).toBe("919876543210");
  expect(downloads).toHaveLength(2);
  if ((await page.locator(".p-shell").getAttribute("data-theme")) !== "dark") {
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).last().click();
    await page.getByRole("switch", { name: "Dark mode" }).click();
    await results.getByRole("button", { name: "Send via WhatsApp", exact: true }).click();
  }
  await page.screenshot({ path: info.outputPath("batch-excel-whatsapp-desktop-dark.png") });
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await dialog.evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && element.scrollWidth <= element.clientWidth; })).toBe(true);
  await page.screenshot({ path: info.outputPath("batch-excel-whatsapp-mobile-dark.png") });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true }).last()).toBeInViewport();
  await page.screenshot({ path: info.outputPath("batch-excel-whatsapp-mobile-footer-dark.png") });
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).last().click();
  await page.reload();
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  await expect(results).toBeVisible();
  await expect(results.locator("tbody tr")).toHaveCount(25);
  const savedAfter = (await (await page.request.get("/api/portal/cards", { headers })).json()).cards;
  expect(savedAfter.filter(card => batch.coupons.some(coupon => coupon.slug === card.slug))
    .map(card => [card.slug, card.status, card.scratchedAt, card.redeemedAt]))
    .toEqual(batchBefore.map(card => [card.slug, card.status, card.scratchedAt, card.redeemedAt]));
  const publicCard = await (await page.request.get(`/api/cards/${firstCard.slug}`)).json();
  expect(JSON.stringify(publicCard)).not.toContain(firstCard.customerPhone);

  // A batch without assigned customer numbers can still be shared to an explicitly entered recipient.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await results.getByRole("button", { name: "Start new draft", exact: true }).click();
  await expect(page.getByLabel("WhatsApp number", { exact: true })).toHaveValue("");
  await page.getByLabel("Coupon quantity 1", { exact: true }).fill("2");
  const freshResponse = page.waitForResponse(response => response.url().endsWith("/api/cards/bulk") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate 2 Coupons", exact: true }).click();
  const fresh = await (await freshResponse).json();
  expect(fresh.savedCount).toBe(2); expect(fresh.coupons.every(card => !card.customerPhone)).toBe(true);
  await expect(results.getByRole("button", { name: "Send via WhatsApp", exact: true })).toBeEnabled();
  await mockWindow();
  await results.getByRole("button", { name: "Send via WhatsApp", exact: true }).click();
  await expect(dialog.getByLabel("Recipient WhatsApp number", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Recipient WhatsApp number", { exact: true }).fill("9876543211");
  await permission.check();
  const freshDownloadPromise = page.waitForEvent("download");
  await submit.click();
  const freshWorkbook = await readWorkbook(await freshDownloadPromise);
  expect(freshWorkbook.rows).toHaveLength(3);
  const phoneColumn = freshWorkbook.rows[0].values.indexOf("WhatsApp Number");
  expect(freshWorkbook.rows.slice(1).every(row => !row.values[phoneColumn])).toBe(true);
  expect(await page.evaluate(() => window.__batchChatCalls.filter(call => call.action === "navigate").length)).toBe(1);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).last().click();

  // A deliberately shared assignment defaults the single recipient, without generating per-coupon chats.
  await results.getByRole("button", { name: "Start new draft", exact: true }).click();
  await page.getByLabel("WhatsApp number", { exact: true }).fill("9876543212");
  await page.getByLabel("Coupon quantity 1", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Generate 2 Coupons", exact: true }).click();
  await expect(results).toBeVisible();
  await results.getByRole("button", { name: "Send via WhatsApp", exact: true }).click();
  await expect(dialog.getByLabel("Recipient WhatsApp number", { exact: true })).toHaveValue("+919876543212");
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).last().click();
  expect(errors).toEqual([]);
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, { headers: rootHeaders, data: { confirmName: business.name } })).status()).toBe(200);
});

test("bulk branch controls continue the same draft across generations, refreshes and retries", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const rootLogin = await page.request.post("/api/auth/login", {
    data: { loginId: "platform@example.test", password: "Platform-Test-Password" },
  });
  const rootHeaders = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", {
    headers: rootHeaders,
    data: { name: "Bulk Branch Controls Business", password: "BRANCHPASS58", limits: { card: 75, branch: 2, account: 1 } },
  });
  expect(created.status()).toBe(201);
  const { business, credentials } = await created.json();
  const ownerLogin = await page.request.post("/api/auth/login", { data: credentials });
  const headers = { Authorization: `Bearer ${(await ownerLogin.json()).token}` };
  const salesResponse = await page.request.post(`/api/portal/businesses/${business.businessId}/branches`, {
    headers, data: { name: "Sales" },
  });
  expect(salesResponse.status()).toBe(201);
  const sales = (await salesResponse.json()).branch;

  await login(page, credentials.loginId, credentials.password);
  await nav(page, "Create scratch card");
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  const addRow = page.getByRole("button", { name: "+ Add Department", exact: true });
  const createBranch = page.getByRole("button", { name: "Create new department", exact: true });
  await expect(addRow).toBeDisabled();
  await expect(page.getByText("All active departments are already in this batch. Create or activate another department to add a row.", { exact: true })).toBeVisible();
  await expect(createBranch).toHaveCount(0);
  await page.getByLabel("Main offer", { exact: true }).fill("30% OFF");
  await page.getByLabel("Campaign name", { exact: true }).fill("Branch draft remains intact");
  await page.getByLabel("Coupon quantity 1", { exact: true }).fill("3");
  const firstResponse = page.waitForResponse(response => response.url().endsWith("/api/cards/bulk") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate 3 Coupons", exact: true }).click();
  const first = await (await firstResponse).json();
  expect(first.savedCount).toBe(3);
  expect(first.coupons.every(card => card.branchId === sales.branchId)).toBe(true);
  const results = page.getByRole("region", { name: "Generated batch results" });
  await expect(results).toBeVisible();
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Main offer", { exact: true })).toBeEnabled();
  await expect(createBranch).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All requested coupons generated", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Manage departments", exact: true }).click();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Departments");
  await page.getByRole("button", { name: "Add department", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add department", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Department name", { exact: true }).fill("Service");
  await dialog.getByLabel("Address", { exact: true }).fill("Second location");
  const branchSaved = page.waitForResponse(response => response.url().endsWith(`/businesses/${business.businessId}/branches`) && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  const savedResponse = await branchSaved;
  expect(savedResponse.status()).toBe(201);
  const service = (await savedResponse.json()).branch;
  await expect(dialog).not.toBeVisible();
  await nav(page, "Create scratch card");
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  await expect(addRow).toBeEnabled();
  await addRow.click();
  await expect(page.getByRole("button", { name: "Bulk Generate", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue("30% OFF");
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue("Branch draft remains intact");
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Bulk department 1", { exact: true })).toHaveValue(sales.branchId);
  await expect(page.getByLabel("Bulk department 2", { exact: true })).toHaveValue(service.branchId);
  await expect(page.getByLabel("Coupon quantity 2", { exact: true })).toHaveValue("25");
  await expect(page.getByLabel("Bulk department 2", { exact: true }).locator(`option[value="${sales.branchId}"]`)).toHaveAttribute("disabled", "");
  await expect(results.locator("tbody tr")).toHaveCount(3);
  await expect(createBranch).toHaveCount(0);
  const savedBusiness = (await (await page.request.get("/api/portal/businesses", { headers })).json()).businesses[0];
  expect(savedBusiness.limits.branch).toBe(2);
  expect(savedBusiness.branches).toHaveLength(2);

  await page.getByLabel("Remove department row 2", { exact: true }).click();
  await expect(addRow).toBeEnabled();
  await addRow.click();
  await expect(page.getByLabel("Bulk department 2", { exact: true })).toHaveValue(service.branchId);
  await expect(page.getByLabel("Coupon quantity 2", { exact: true })).toHaveValue("25");
  await page.getByLabel("Coupon quantity 2", { exact: true }).fill("2");
  await expect(page.getByRole("button", { name: "Generate 2 Coupons", exact: true })).toBeEnabled();
  await expect(page.locator(".bulk-summary")).toContainText("Saved in this draft: 3 coupons");
  await expect(page.locator(".bulk-summary")).toContainText("Remaining to generate: 2 coupons");

  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  if ((await page.locator(".p-shell").getAttribute("data-theme")) !== "light") {
    await page.getByRole("switch", { name: "Dark mode" }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".bulk-branches").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.locator(".bulk-state-notice").evaluate(element => getComputedStyle(element).color === getComputedStyle(document.querySelector(".p-shell")).color)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("bulk-new-branch-mobile-light.png"), fullPage: true });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".bulk-state-notice").evaluate(element => getComputedStyle(element).color === getComputedStyle(document.querySelector(".p-shell")).color)).toBe(true);
  await page.screenshot({ path: info.outputPath("bulk-new-branch-mobile-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const generate = async (count) => {
    const response = page.waitForResponse(item => item.url().endsWith("/api/cards/bulk") && item.request().method() === "POST");
    await page.getByRole("button", { name: `Generate ${count} Coupons`, exact: true }).click();
    const saved = await response;
    expect(saved.status()).toBe(201);
    const batch = await saved.json();
    expect(batch.savedCount).toBe(count);
    expect(saved.request().postDataJSON().branches).toEqual([{ branchId: service.branchId, quantity: count }]);
    expect(batch.coupons.every(card => card.branchId === service.branchId)).toBe(true);
    return batch;
  };
  let lostBatch;
  await page.route("**/api/cards/bulk", async route => {
    expect(route.request().postDataJSON().branches).toEqual([{ branchId: service.branchId, quantity: 2 }]);
    const response = await route.fetch();
    lostBatch = await response.json();
    expect(lostBatch.savedCount).toBe(2);
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "Generate 2 Coupons", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry saved batch", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Remove department row 2", { exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Single Card", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  await expect(results.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue("30% OFF");
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue("Branch draft remains intact");
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Coupon quantity 2", { exact: true })).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Retry saved batch", exact: true })).toBeEnabled();
  await results.getByLabel("Filter batch by department").selectOption(sales.branchId);
  const retryResponse = page.waitForResponse(response => response.url().endsWith("/api/cards/bulk") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Retry saved batch", exact: true }).click();
  const second = await (await retryResponse).json();
  expect(second.replayed).toBe(true);
  expect(second.batchId).toBe(lostBatch.batchId);
  await expect(results).toContainText("5 coupons saved in this draft");
  await expect(results.getByLabel("Filter batch by department")).toHaveValue(sales.branchId);
  await expect(results.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Remove department row 2", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue("30% OFF");
  await results.getByLabel("Filter batch by department").selectOption(service.branchId);
  await expect(results.locator("tbody tr")).toHaveCount(2);
  await page.getByLabel("Coupon quantity 2", { exact: true }).fill("4");
  const third = await generate(2);
  await expect(results.locator("tbody tr")).toHaveCount(4);
  await expect(results).toContainText("7 coupons saved in this draft");
  expect(second.batchId).not.toBe(first.batchId);
  expect(third.batchId).not.toBe(second.batchId);
  const allCoupons = [...first.coupons, ...second.coupons, ...third.coupons];
  expect(new Set(allCoupons.map(card => card.couponCode)).size).toBe(7);
  expect(new Set(allCoupons.map(card => card.slug)).size).toBe(7);
  await page.route("**/api/portal/batches/**", route => {
    if (decodeURIComponent(new URL(route.request().url()).pathname).endsWith(third.batchId))
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Draft recovery unavailable" }) });
    return route.continue();
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Single Card", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Bulk Generate", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Draft recovery unavailable");
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toBeDisabled();
  await expect(page.locator('button[value="create-link"]')).toBeDisabled();
  await page.unroute("**/api/portal/batches/**");
  await page.getByRole("button", { name: "Retry loading batch", exact: true }).click();
  await expect(results).toBeVisible();
  await expect(results.locator("tbody tr")).toHaveCount(7);
  await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue("30% OFF");
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue("Branch draft remains intact");
  await expect(page.getByLabel("Coupon quantity 2", { exact: true })).toHaveValue("4");
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Remove department row 2", { exact: true })).toBeEnabled();
  await results.getByLabel("Filter batch by department").selectOption(sales.branchId);
  await expect(results.locator("tbody tr")).toHaveCount(3);
  const fileReady = page.waitForEvent("download");
  await results.getByRole("button", { name: "Download Excel", exact: true }).click();
  const archive = unzipSync(await fs.readFile(await (await fileReady).path()));
  expect((strFromU8(archive["xl/worksheets/sheet1.xml"]).match(/<row\b/g) || []).length).toBe(8);
  const workbook = Object.values(archive).map(value => strFromU8(value)).join(" ");
  for (const card of allCoupons) { expect(workbook).toContain(card.couponCode); expect(workbook).toContain(`/card/${card.slug}`); }
  // Sharing also reloads every generation, even when the results show Sales only.
  await page.evaluate(() => {
    window.__continuousChats = [];
    window.open = (url, target) => {
      window.__continuousChats.push({ action: "open", url, target });
      return { closed: false, opener: null,
        location: { replace: url => window.__continuousChats.push({ action: "navigate", url }) },
        close: () => window.__continuousChats.push({ action: "close" }) };
    };
  });
  await results.getByRole("button", { name: "Send via WhatsApp", exact: true }).click();
  const shareDialog = page.getByRole("dialog", { name: "Send batch Excel via WhatsApp Web", exact: true });
  await shareDialog.getByLabel("Recipient WhatsApp number", { exact: true }).fill("9876543210");
  await shareDialog.getByLabel("I have permission to share these coupons and contact details with this number", { exact: true }).check();
  const shareSubmit = shareDialog.getByRole("button", { name: "Download Excel & open WhatsApp Web", exact: true });
  const batchReads = [], shareDownloads = [];
  page.on("download", download => shareDownloads.push(download));
  await page.route("**/api/portal/batches/**", route => {
    if (decodeURIComponent(new URL(route.request().url()).pathname).endsWith(third.batchId))
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Third generation unavailable" }) });
    return route.continue();
  });
  await shareSubmit.click();
  await expect(shareDialog.getByRole("alert")).toContainText("Third generation unavailable");
  expect(shareDownloads).toHaveLength(0);
  expect(await page.evaluate(() => window.__continuousChats.map(call => call.action))).toEqual(["open", "close"]);
  await page.unroute("**/api/portal/batches/**");
  page.on("request", request => {
    if (request.url().includes("/api/portal/batches/")) batchReads.push(decodeURIComponent(new URL(request.url()).pathname).split("/").at(-1));
  });
  const shareFileReady = page.waitForEvent("download");
  await shareSubmit.click();
  const shareArchive = unzipSync(await fs.readFile(await (await shareFileReady).path()));
  expect((strFromU8(shareArchive["xl/worksheets/sheet1.xml"]).match(/<row\b/g) || []).length).toBe(8);
  const sharedWorkbook = Object.values(shareArchive).map(value => strFromU8(value)).join(" ");
  expect(sharedWorkbook).toContain("WhatsApp Number");
  for (const card of allCoupons) { expect(sharedWorkbook).toContain(card.couponCode); expect(sharedWorkbook).toContain(`/card/${card.slug}`); }
  expect(new Set(batchReads)).toEqual(new Set([first.batchId, second.batchId, third.batchId]));
  await expect(shareDialog.getByRole("status")).toContainText("7");
  const chats = await page.evaluate(() => window.__continuousChats);
  expect(chats.filter(call => call.action === "navigate")).toHaveLength(1);
  const continuousChatUrl = new URL(chats.find(call => call.action === "navigate").url);
  expect(continuousChatUrl.origin).toBe("https://web.whatsapp.com");
  expect(continuousChatUrl.pathname).toBe("/send");
  expect(continuousChatUrl.searchParams.get("phone")).toBe("919876543210");
  await shareDialog.getByRole("button", { name: "Close dialog", exact: true }).last().click();
  await page.getByLabel("Remove department row 1", { exact: true }).click();
  await addRow.click();
  await expect(page.getByLabel("Bulk department 2", { exact: true })).toHaveValue(sales.branchId);
  await expect(page.getByRole("button", { name: "Generate 22 Coupons", exact: true })).toBeEnabled();
  await page.getByLabel("Coupon quantity 2", { exact: true }).fill("3");
  await expect(page.getByRole("button", { name: "All requested coupons generated", exact: true })).toBeDisabled();
  await expect(createBranch).toHaveCount(0);
  const savedCards = (await (await page.request.get("/api/portal/cards", { headers })).json()).cards;
  expect(savedCards).toHaveLength(7);
  expect(savedCards.every(card => card.offerTitle === "30% OFF" && card.campaignName === "Branch draft remains intact")).toBe(true);
  expect(errors).toEqual([]);
  const cleanupLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const cleanupHeaders = { Authorization: `Bearer ${(await cleanupLogin.json()).token}` };
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, {
    headers: cleanupHeaders, data: { confirmName: business.name },
  })).status()).toBe(200);
});

test("business creates branch staff with a mandatory manual login ID and super admin monitors it", async ({ page }) => {
  const rootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const rootHeaders = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const createdResponse = await page.request.post("/api/portal/businesses", { headers: rootHeaders, data: {
    name: "Branch Portal Retail", loginId: "BRPORT58", password: "Branch-Portal-Owner",
    limits: { card: 10, branch: 2, department: 2, account: 2 }, generateCredentials: true,
  } });
  expect(createdResponse.status()).toBe(201);
  const business = (await createdResponse.json()).business;
  const ownerLogin = await page.request.post("/api/auth/login", { data: { loginId: "BRPORT58", password: "Branch-Portal-Owner" } });
  const ownerHeaders = { Authorization: `Bearer ${(await ownerLogin.json()).token}` };
  const northResponse = await page.request.post(`/api/portal/businesses/${business.businessId}/branches`, { headers: ownerHeaders, data: { name: "North Showroom" } });
  const southResponse = await page.request.post(`/api/portal/businesses/${business.businessId}/branches`, { headers: ownerHeaders, data: { name: "South Showroom" } });
  const north = (await northResponse.json()).branch, south = (await southResponse.json()).branch;
  const cardData = { businessId: business.businessId, headline: "Branch reward", offerTitle: "15% OFF",
    description: "Branch staff test", campaignName: "Branch campaign", customerPhone: "9876543210" };
  const northCard = await (await page.request.post("/api/cards", { headers: ownerHeaders, data: { ...cardData, branchId: north.branchId, couponCode: "STAFF-NORTH" } })).json();
  const southCard = await (await page.request.post("/api/cards", { headers: ownerHeaders, data: { ...cardData, branchId: south.branchId, couponCode: "STAFF-SOUTH" } })).json();

  await login(page, "BRPORT58", "Branch-Portal-Owner");
  await nav(page, "Department staff");
  await page.getByRole("button", { name: "Add department staff", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create department staff login", exact: true });
  const assignment = dialog.getByRole("combobox", { name: "Branch and department", exact: true });
  await expect(assignment).not.toContainText("Branch Portal Retail");
  await expect(assignment).toContainText("Unassigned · North Showroom");
  await dialog.getByLabel("Staff name", { exact: true }).fill("Nina North");
  const loginIdField = dialog.getByLabel("Login ID", { exact: true });
  await expect(loginIdField).toHaveAttribute("required", "");
  await loginIdField.fill("NINANORTH58");
  await dialog.locator("select").selectOption(north.branchId);
  await dialog.getByLabel("Password", { exact: true }).fill("Nina-Branch-Password");
  await dialog.getByLabel("Confirm password", { exact: true }).fill("Nina-Branch-Password");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  const credentials = await createdCredentials(page);
  expect(credentials.loginId).toBe("NINANORTH58");
  await expandBranchGroups(page);
  const staffRow = page.getByRole("row").filter({ hasText: "Nina North" });
  await expect(staffRow).toContainText("Branch Portal Retail");
  await expect(staffRow).toContainText("North Showroom");
  await expect(staffRow).toContainText("Never");
  await expect(staffRow).toContainText(credentials.loginId);
  expect((await page.request.post(`/api/cards/${northCard.slug}/claim`)).status()).toBe(200);
  const scratchedCard = (await (await page.request.get("/api/portal/cards", { headers: ownerHeaders })).json()).cards
    .find((card) => card.slug === northCard.slug);
  expect(scratchedCard.status).toBe("scratched");
  expect(scratchedCard.used).toBe(false);
  expect(scratchedCard.revealed).toBe(true);

  await page.goto(`/card/${northCard.slug}`);
  await expect(page.getByRole("button", { name: "Copy code", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "QR Code", exact: true }).click();
  const customerQrDialog = page.getByRole("dialog", { name: "Scan to redeem", exact: true });
  const qrDataUrl = await customerQrDialog.getByRole("img").getAttribute("src");
  expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
  const qrImage = Buffer.from(qrDataUrl.split(",")[1], "base64");
  await customerQrDialog.locator(".coupon-qr-done").click();
  await page.goto("/");

  await page.locator(".p-topbar").getByRole("button", { name: "Sign out" }).click();
  await login(page, credentials.loginId, credentials.password);
  await expect(page.getByRole("heading", { name: "North Showroom", exact: true })).toBeVisible();
  await expect(page.locator(".p-sidebar nav").getByRole("button")).toHaveCount(4);
  await expect(page.locator(".p-sidebar nav").getByRole("button")).toHaveText([
    "Overview", "Redeem coupon", "Department coupons", "Redemption history",
  ]);
  await expect(page.locator(".p-sidebar nav").getByRole("button", { name: "Create scratch card", exact: true })).toHaveCount(0);
  await expect(page.locator(".p-staff-metrics article")).toHaveCount(2);
  await expect(page.getByText("Ready to redeem", { exact: true })).toHaveCount(0);
  await nav(page, "Department coupons");
  await expect(page.getByRole("heading", { name: "Department coupons", exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "STAFF-NORTH" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "STAFF-SOUTH" })).toHaveCount(0);
  await nav(page, "Redeem coupon");
  await page.getByLabel("Coupon code", { exact: true }).fill("staff-south");
  await page.getByRole("main").getByRole("button", { name: "Redeem coupon", exact: true }).click();
  const wrongBranchPopup = page.getByRole("alertdialog");
  await expect(wrongBranchPopup.getByRole("heading", { name: "Wrong department" })).toBeVisible();
  await expect(wrongBranchPopup).toContainText("Not redeemed");
  await expect(wrongBranchPopup).toContainText("South Showroom");
  await expect(wrongBranchPopup).not.toContainText("Staff member");
  await wrongBranchPopup.getByRole("button", { name: "Try another code", exact: true }).click();
  await page.getByRole("main").getByRole("button", { name: "Scan QR code", exact: true }).click();
  const scannerDialog = page.getByRole("dialog", { name: "Scan coupon QR code", exact: true });
  await expect(scannerDialog).toContainText("Upload QR image");
  await scannerDialog.locator('input[type="file"]').setInputFiles({
    name: "staff-north-qr.png",
    mimeType: "image/png",
    buffer: qrImage,
  });
  const successPopup = page.getByRole("alertdialog");
  await expect(successPopup).toHaveClass(/is-success/);
  const successPopupBox = await successPopup.boundingBox();
  expect(successPopupBox?.width).toBeGreaterThan(350);
  expect(successPopupBox?.height).toBeGreaterThan(300);
  await expect(successPopup.getByRole("heading", { name: "Coupon redeemed" })).toBeVisible();
  await expect(successPopup).toContainText("STAFF-NORTH");
  await expect(successPopup).toContainText("North Showroom");
  await expect(successPopup).toContainText("Nina North");
  await expect(successPopup).toContainText("Date & time");
  await expect(successPopup.locator(".p-result-symbol svg")).toBeVisible();
  await successPopup.getByRole("button", { name: "Done", exact: true }).click();
  await expect(successPopup).toHaveCount(0);
  await page.getByLabel("Coupon code", { exact: true }).fill("staff-north");
  await page.getByRole("main").getByRole("button", { name: "Redeem coupon", exact: true }).click();
  const errorPopup = page.getByRole("alertdialog");
  await expect(errorPopup).toHaveClass(/is-error/);
  await expect(errorPopup.getByRole("heading", { name: "Coupon cannot be redeemed" })).toBeVisible();
  await expect(errorPopup).toContainText("already been redeemed");
  await expect(errorPopup).toContainText("North Showroom");
  await expect(errorPopup).toContainText("Nina North");
  await expect(errorPopup).toContainText("Date & time");
  await expect(errorPopup.locator(".p-result-symbol svg")).toBeVisible();
  await expect(page.locator(".p-content > .p-alert.error")).toHaveCount(0);
  await errorPopup.getByRole("button", { name: "Try another code", exact: true }).click();
  const redeemedCard = (await (await page.request.get(`/api/portal/cards?business=${business.businessId}`, { headers: rootHeaders })).json()).cards
    .find((card) => card.slug === northCard.slug);
  expect(redeemedCard.status).toBe("redeemed");
  expect(redeemedCard.used).toBe(true);
  await page.goto(`/card/${northCard.slug}`);
  await expect(page.locator(".scratch-shell")).toHaveClass(/is-redeemed/);
  await expect(page.locator(".redeemed-coupon-label")).toHaveText("COUPON REDEEMED");
  await expect(page.getByText("STAFF-NORTH", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy code", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "QR Code", exact: true })).toHaveCount(0);
  await page.goto("/");
  await nav(page, "Overview");
  await expect(page.getByText("Ready to redeem", { exact: true })).toHaveCount(0);
  await expect(page.locator(".p-metrics article").filter({ hasText: "Total redeemed" }).locator("strong")).toHaveText("1");
  await nav(page, "Department coupons");
  await expect(page.getByRole("row").filter({ hasText: "STAFF-NORTH" })).toContainText("redeemed");
  await nav(page, "Redemption history");
  await expect(page.getByRole("row").filter({ hasText: "STAFF-NORTH" })).toContainText("redeemed");

  await page.locator(".p-topbar").getByRole("button", { name: "Sign out" }).click();
  await login(page, "platform@example.test", "Platform-Test-Password");
  await nav(page, "Department staff");
  const businessFilter = page.getByLabel("Filter by business", { exact: true });
  await expect(businessFilter).toBeVisible();
  await businessFilter.selectOption(business.businessId);
  await expandBranchGroups(page);
  const monitoredRow = page.getByRole("row").filter({ hasText: "Nina North" });
  await expect(monitoredRow).not.toContainText("Never");
  await expect(monitoredRow).toContainText("1");
  await expect(monitoredRow.getByRole("button", { name: "Manage staff", exact: true })).toBeVisible();
  expect((await page.request.get(`/api/cards/${northCard.slug}`)).status()).toBe(200);
  expect((await page.request.get(`/api/cards/${southCard.slug}`)).status()).toBe(200);
  const finalRootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const finalRootHeaders = { Authorization: `Bearer ${(await finalRootLogin.json()).token}` };
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, {
    headers: finalRootHeaders, data: { confirmName: business.name },
  })).status()).toBe(200);
});

test("branch arrows reveal only their departments and keep duplicate names separate", async ({ page }, info) => {
  const auth = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const headers = { Authorization: `Bearer ${(await auth.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers, data: {
    name: "Branch accordion business", loginId: "ACCORDION88", password: "Accordion-Test-Password",
    limits: { card: 0, branch: 0, department: 0, account: 0 },
  } });
  expect(created.status()).toBe(201);
  const { business } = await created.json();
  const hierarchy = await page.request.post(`/api/portal/businesses/${business.businessId}/departments/branches`, { headers, data: {
    departments: [
      { name: "Central", branches: [{ name: "Sales" }, { name: "Service" }] },
      { name: "Central", branches: [{ name: "Support" }] },
      { name: "West", branches: [{ name: "Development" }] },
    ],
  } });
  expect(hierarchy.status()).toBe(201);
  const structure = await hierarchy.json();
  const legacyUnits = [];
  for (const name of ["Legacy A", "Legacy B"]) {
    const legacy = await page.request.post(`/api/portal/businesses/${business.businessId}/branches`, { headers, data: { name } });
    expect(legacy.status()).toBe(201);
    legacyUnits.push((await legacy.json()).branch);
  }
  await login(page, "ACCORDION88", "Accordion-Test-Password");
  await nav(page, "Departments");
  const groups = page.locator(".p-branch-group");
  const first = groups.nth(0);
  const second = groups.nth(1);
  const firstToggle = first.locator(".p-branch-toggle");
  await expect(groups).toHaveCount(4);
  await expect(page.locator('.p-branch-toggle[aria-expanded="false"]')).toHaveCount(4);
  const unassigned = groups.filter({ hasText: "Unassigned" });
  await unassigned.locator(".p-branch-toggle").click();
  await expect(unassigned.getByRole("cell", { name: "Legacy A", exact: true })).toBeVisible();
  await expect(unassigned.getByRole("cell", { name: "Legacy B", exact: true })).toBeVisible();
  await unassigned.locator(".p-branch-toggle").click();
  await expect(page.getByRole("cell", { name: "Sales", exact: true })).toHaveCount(0);
  await firstToggle.click();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  await expect(first.getByRole("cell", { name: "Sales", exact: true })).toBeVisible();
  await expect(first.getByRole("cell", { name: "Service", exact: true })).toBeVisible();
  await expect(first.getByRole("columnheader", { name: "Branch", exact: true })).toHaveCount(0);
  await expect(first.getByRole("cell", { name: "Central", exact: true })).toHaveCount(0);
  await expect(first.getByRole("columnheader", { name: "Department", exact: true })).toBeVisible();
  await expect(first).not.toContainText("Support");
  await expect(second.locator(".p-branch-toggle")).toHaveAttribute("aria-expanded", "false");
  await second.locator(".p-branch-toggle").click();
  await expect(second.getByRole("cell", { name: "Support", exact: true })).toBeVisible();
  await expect(second).not.toContainText("Sales");
  // A management action must not also collapse/expand its branch.
  await first.getByRole("button", { name: "Delete branch", exact: true }).click();
  const branchConfirmation = page.getByRole("alertdialog", { name: "Delete branch?", exact: true });
  await expect(branchConfirmation).toBeVisible();
  await expect(branchConfirmation).toContainText("Central");
  await expect(branchConfirmation).toContainText("all departments under it");
  await page.screenshot({ path: info.outputPath("branch-confirm-light.png"), fullPage: true });
  await branchConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  await firstToggle.focus();
  await page.keyboard.press("Enter");
  await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: info.outputPath("branch-accordion-light.png"), fullPage: true });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(first.locator(".p-department-control")).toHaveCSS("background-color", "rgb(16, 30, 45)");
  await expect(firstToggle).toHaveCSS("color", "rgb(237, 240, 247)");
  await expect(first.getByRole("button", { name: "Delete branch", exact: true })).toHaveCSS("background-color", "rgb(66, 38, 50)");
  await page.screenshot({ path: info.outputPath("branch-accordion-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("branch-accordion-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Searching and filters reveal their matching departments automatically.
  await page.getByRole("combobox", { name: "Filter by department", exact: true }).selectOption("support");
  await expect(groups).toHaveCount(1);
  await expect(groups.locator(".p-branch-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(groups.getByRole("cell", { name: "Support", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by department", exact: true }).selectOption("");
  await page.getByRole("textbox", { name: "Search Departments", exact: true }).fill("Development");
  await expect(groups).toHaveCount(1);
  await expect(groups).toContainText("West");
  await expect(groups.getByRole("cell", { name: "Development", exact: true })).toBeVisible();

  for (const [index, unit] of [structure.branches[0], structure.branches[1], structure.branches[2], legacyUnits[0]].entries()) {
    const staff = await page.request.post("/api/portal/users", { headers, data: {
      businessId: business.businessId, branchId: unit.branchId, role: "branch-staff",
      name: `Accordion staff ${index + 1}`, loginId: `ACCORDIONSTAFF${index + 1}`, password: "Accordion-Staff-Password",
    } });
    expect(staff.status()).toBe(201);
  }
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await nav(page, "Department staff");
  await expect(groups).toHaveCount(3);
  await expect(page.locator('.p-branch-toggle[aria-expanded="false"]')).toHaveCount(3);
  await expect(page.getByText("Accordion staff 1", { exact: true })).toHaveCount(0);
  await firstToggle.click();
  await expect(first.getByText("Accordion staff 1", { exact: true })).toBeVisible();
  await expect(first.getByText("Accordion staff 2", { exact: true })).toBeVisible();
  await expect(first.getByRole("columnheader", { name: "Branch", exact: true })).toHaveCount(0);
  await expect(first.getByRole("cell", { name: "Central", exact: true })).toHaveCount(0);
  await expect(first.getByRole("columnheader", { name: "Department", exact: true })).toBeVisible();
  await expect(first).toContainText("Service");
  await expect(second.locator(".p-branch-toggle")).toHaveAttribute("aria-expanded", "false");
  await second.locator(".p-branch-toggle").click();
  await expect(second.getByText("Accordion staff 3", { exact: true })).toBeVisible();
  await expect(second).not.toContainText("Accordion staff 1");
  await first.getByRole("row").filter({ hasText: "Accordion staff 2" }).getByRole("button", { name: "Manage staff", exact: true }).click();
  const staffDialog = page.getByRole("dialog", { name: "Manage Accordion staff 2", exact: true });
  const staffAssignment = staffDialog.getByRole("combobox", { name: "Assigned branch and department", exact: true });
  await expect(staffAssignment).toHaveValue(structure.branches[1].branchId);
  await expect(staffAssignment.locator("option:checked")).toHaveText("Central · Service");
  await expect(staffAssignment).not.toContainText(business.name);
  await staffDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  await unassigned.locator(".p-branch-toggle").click();
  await expect(unassigned.getByText("Accordion staff 4", { exact: true })).toBeVisible();
  await unassigned.locator(".p-branch-toggle").click();
  await page.screenshot({ path: info.outputPath("staff-accordion-dark.png"), fullPage: true });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(first.locator(".p-department-control")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "Add department staff", exact: true })).toHaveCSS("background-color", "rgb(0, 43, 92)");
  await page.screenshot({ path: info.outputPath("staff-accordion-light.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("staff-accordion-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("textbox", { name: "Search Department staff", exact: true }).fill("Service");
  await expect(groups).toHaveCount(1);
  await expect(groups.getByText("Accordion staff 2", { exact: true })).toBeVisible();
  const staffDelete = groups.getByRole("button", { name: "Delete staff", exact: true });
  const nativePrompts = [];
  const unexpectedPrompt = async dialog => { nativePrompts.push(dialog.type()); await dialog.dismiss(); };
  page.on("dialog", unexpectedPrompt);
  const deleteConfirmation = page.getByRole("alertdialog", { name: "Delete staff account?", exact: true });
  await staffDelete.click();
  await expect(deleteConfirmation).toBeVisible();
  await expect(deleteConfirmation).toContainText("Accordion staff 2");
  await expect(deleteConfirmation).toContainText("redemption history will be kept");
  await expect(deleteConfirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath("staff-confirm-light.png"), fullPage: true });
  await deleteConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(deleteConfirmation).toHaveCount(0);
  await expect(staffDelete).toBeFocused();
  await staffDelete.click();
  await page.keyboard.press("Escape");
  await expect(deleteConfirmation).toHaveCount(0);
  await expect(staffDelete).toBeFocused();
  await expect(groups.getByText("Accordion staff 2", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await staffDelete.click();
  await expect(deleteConfirmation).toHaveCSS("background-color", "rgb(27, 35, 50)");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  expect(await deleteConfirmation.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath("staff-confirm-dark-mobile.png"), fullPage: true });
  await deleteConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  const staffLogin = await page.request.post("/api/auth/login", { data: {
    loginId: "ACCORDIONSTAFF2", password: "Accordion-Staff-Password",
  } });
  expect(staffLogin.status()).toBe(200);
  const deletedToken = (await staffLogin.json()).token;
  const deleteEndpoint = "**/api/portal/users/*";
  await page.route(deleteEndpoint, route => route.request().method() === "DELETE"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary delete failure. Try again." }) })
    : route.fallback());
  await staffDelete.click();
  await deleteConfirmation.getByRole("button", { name: "Delete staff", exact: true }).click();
  await expect(deleteConfirmation.getByRole("alert")).toHaveText("Temporary delete failure. Try again.");
  await expect(deleteConfirmation.getByRole("button", { name: "Delete staff", exact: true })).toBeEnabled();
  await page.unroute(deleteEndpoint);
  let releaseDelete;
  let deleteRequests = 0;
  const deleteGate = new Promise(resolve => { releaseDelete = resolve; });
  await page.route(deleteEndpoint, async route => {
    if (route.request().method() === "DELETE") { deleteRequests++; await deleteGate; }
    await route.fallback();
  });
  await deleteConfirmation.getByRole("button", { name: "Delete staff", exact: true }).click();
  await expect(deleteConfirmation).toHaveAttribute("aria-busy", "true");
  await expect(deleteConfirmation.getByRole("button", { name: "Deleting…", exact: true })).toBeDisabled();
  await expect(deleteConfirmation.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(deleteConfirmation).toBeVisible();
  releaseDelete();
  await expect(page.getByText("No records found", { exact: true })).toBeVisible();
  await expect(deleteConfirmation).toHaveCount(0);
  expect(deleteRequests).toBe(1);
  expect(nativePrompts).toEqual([]);
  page.off("dialog", unexpectedPrompt);
  await page.unroute(deleteEndpoint);
  await expect(page.getByText("Accordion staff 2", { exact: true })).toHaveCount(0);
  expect((await page.request.get("/api/auth/me", { headers: { Authorization: `Bearer ${deletedToken}` } })).status()).toBe(401);
  const retainedStaff = (await (await page.request.get(`/api/portal/users?business=${business.businessId}`, { headers })).json()).users;
  expect(retainedStaff.map(staff => staff.name).sort()).toEqual(["Accordion staff 1", "Accordion staff 3", "Accordion staff 4"]);
  await page.getByRole("textbox", { name: "Search Department staff", exact: true }).fill("");
  await expandBranchGroups(page);
  await page.screenshot({ path: info.outputPath("staff-delete-light.png"), fullPage: true });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(page.getByRole("button", { name: "Delete staff", exact: true }).first()).toHaveCSS("background-color", "rgb(66, 38, 50)");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("staff-delete-dark-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav(page, "Departments");
  page.on("dialog", unexpectedPrompt);
  const westGroup = groups.filter({ hasText: "West" });
  await westGroup.getByRole("button", { name: "Delete branch", exact: true }).click();
  await expect(branchConfirmation).toBeVisible();
  await expect(branchConfirmation).toContainText("West");
  await expect(branchConfirmation).toContainText("archived for super administrators");
  await expect(branchConfirmation).toHaveCSS("background-color", "rgb(27, 35, 50)");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("branch-confirm-dark-mobile.png"), fullPage: true });
  await branchConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(westGroup).toBeVisible();
  await westGroup.getByRole("button", { name: "Delete branch", exact: true }).click();
  await branchConfirmation.getByRole("button", { name: "Delete branch", exact: true }).click();
  await expect(branchConfirmation).toHaveCount(0);
  await expect(westGroup).toHaveCount(0);
  await expect(page.locator(".p-branch-toggle").filter({ hasText: "Central" })).toHaveCount(2);
  const archivedBusiness = (await (await page.request.get("/api/portal/businesses", { headers })).json()).businesses
    .find(item => item.businessId === business.businessId);
  expect(archivedBusiness.departments.find(item => item.name === "West").status).toBe("deleted");
  expect(archivedBusiness.branches.find(item => item.name === "Development").status).toBe("deleted");
  if (await unassigned.locator(".p-branch-toggle").getAttribute("aria-expanded") === "false")
    await unassigned.locator(".p-branch-toggle").click();
  const legacyRow = unassigned.getByRole("row").filter({ hasText: "Legacy B" });
  await legacyRow.getByRole("button", { name: "Delete department", exact: true }).click();
  const departmentConfirmation = page.getByRole("alertdialog", { name: "Delete department?", exact: true });
  await expect(departmentConfirmation).toContainText("Legacy B");
  await page.keyboard.press("Escape");
  await expect(departmentConfirmation).toHaveCount(0);
  await expect(legacyRow).toBeVisible();
  await legacyRow.getByRole("button", { name: "Delete department", exact: true }).click();
  await departmentConfirmation.getByRole("button", { name: "Delete department", exact: true }).click();
  await expect(departmentConfirmation).toHaveCount(0);
  await expect(legacyRow).toHaveCount(0);
  await expect(unassigned.getByRole("cell", { name: "Legacy A", exact: true })).toBeVisible();
  expect(nativePrompts).toEqual([]);
  page.off("dialog", unexpectedPrompt);
});

test("Sales staff redeem another location's coupon and history counts the actual redeeming location", async ({ page }, info) => {
  const auth = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const headers = { Authorization: `Bearer ${(await auth.json()).token}` };
  const response = await page.request.post("/api/portal/businesses", { headers, data: {
    name: "Cross-location browser business", loginId: "CROSSBROWSER88", password: "Cross-Browser-Password",
    limits: { card: 0, branch: 0, department: 0, account: 0 },
  } });
  expect(response.status()).toBe(201);
  const { business } = await response.json();
  const hierarchyResponse = await page.request.post(`/api/portal/businesses/${business.businessId}/departments/branches`, { headers, data: {
    departments: [
      { name: "Ameerpet", branches: [{ name: "Sales" }] },
      { name: "Punjagutta", branches: [{ name: "Sales" }] },
    ],
  } });
  expect(hierarchyResponse.status()).toBe(201);
  const hierarchy = await hierarchyResponse.json();
  const serviceResponse = await page.request.post(`/api/portal/businesses/${business.businessId}/branches`, { headers, data: {
    name: "Service", departmentId: hierarchy.departments[0].departmentId,
  } });
  expect(serviceResponse.status()).toBe(201);
  hierarchy.branches.push((await serviceResponse.json()).branch);
  await login(page, "platform@example.test", "Platform-Test-Password");
  await nav(page, "Department staff");
  await page.getByRole("button", { name: "Add department staff", exact: true }).click();
  const assignmentDialog = page.getByRole("dialog", { name: "Create department staff login", exact: true });
  const assignmentSelect = assignmentDialog.getByRole("combobox", { name: "Business, branch and department", exact: true });
  await expect(assignmentSelect.getByRole("option", { name: `${business.name} · Ameerpet · Sales`, exact: true }))
    .toHaveAttribute("value", hierarchy.branches[0].branchId);
  await expect(assignmentSelect.getByRole("option", { name: `${business.name} · Punjagutta · Sales`, exact: true }))
    .toHaveAttribute("value", hierarchy.branches[1].branchId);
  await assignmentSelect.selectOption(hierarchy.branches[1].branchId);
  await expect(assignmentSelect).toHaveValue(hierarchy.branches[1].branchId);
  await assignmentDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const [index, name, loginId] of [[0, "Ameerpet sales staff", "AMSALESTEST88"], [1, "Punjagutta sales staff", "PJSALESTEST88"], [2, "Ameerpet service staff", "AMSERVICETEST88"]]) {
    const staff = await page.request.post("/api/portal/users", { headers, data: {
      businessId: business.businessId, branchId: hierarchy.branches[index].branchId,
      name, loginId, password: "Cross-Staff-Password", role: "branch-staff", generateCredentials: true,
    } });
    expect(staff.status()).toBe(201);
  }
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  const staffRows = page.locator(".p-table-scroll tbody tr").filter({ has: page.getByRole("button", { name: "Manage staff", exact: true }) });
  const locationFilter = page.getByRole("combobox", { name: "Filter by branch", exact: true });
  const departmentFilter = page.getByRole("combobox", { name: "Filter by department", exact: true });
  const departmentRows = page.locator(".p-table-scroll tbody tr").filter({ has: page.getByRole("button", { name: "Edit", exact: true }) });
  await nav(page, "Departments");
  await page.getByRole("combobox", { name: "Filter by business", exact: true }).selectOption(business.businessId);
  await departmentFilter.selectOption("sales");
  await expect(departmentRows).toHaveCount(2);
  await locationFilter.selectOption({ label: `${business.name} · Ameerpet` });
  await expect(departmentRows).toHaveCount(2);
  await departmentFilter.selectOption("service");
  await expect(departmentRows).toHaveCount(1);
  await page.getByRole("combobox", { name: "Filter by business", exact: true }).selectOption("");
  await expect(locationFilter).toHaveValue("");
  await expect(departmentFilter).toHaveValue("");
  await nav(page, "Department staff");
  await page.getByRole("combobox", { name: "Filter by business", exact: true }).selectOption(business.businessId);
  await expandBranchGroups(page);
  await expect(staffRows).toHaveCount(3);
  await departmentFilter.selectOption("sales");
  await expect(staffRows).toHaveCount(2);
  await page.getByRole("textbox", { name: "Search Department staff", exact: true }).fill("Punjagutta");
  await expect(staffRows).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search Department staff", exact: true }).fill("");
  await locationFilter.selectOption({ label: `${business.name} · Ameerpet` });
  await expect(departmentFilter).toHaveValue("");
  await expect(staffRows).toHaveCount(2);
  await departmentFilter.selectOption("sales");
  await expect(staffRows).toHaveCount(1);
  await expect(staffRows).toContainText("Ameerpet sales staff");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(staffRows).toHaveCount(1);
  await expect(departmentFilter).toHaveValue("sales");
  await locationFilter.selectOption({ label: `${business.name} · Punjagutta` });
  await expect(departmentFilter.locator('option[value="service"]')).toHaveCount(0);
  await expect(staffRows).toHaveCount(1);
  await expect(staffRows).toContainText("Punjagutta sales staff");
  await locationFilter.selectOption("unassigned");
  await expect(staffRows).toHaveCount(0);
  await expect(page.getByText("No records found", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by business", exact: true }).selectOption("");
  await expect(locationFilter).toHaveValue("");
  await expect(departmentFilter).toHaveValue("");
  await expandBranchGroups(page);
  for (const location of ["Ameerpet", "Punjagutta"]) {
    const staffRow = page.getByRole("row").filter({ hasText: `${location} sales staff` });
    await expect(staffRow.locator('td[data-label="Branch"]')).toHaveCount(0);
    await expect(page.locator(".p-branch-group").filter({ has: staffRow }).locator(".p-branch-toggle")).toContainText(location);
    await expect(staffRow.locator('td[data-label="Department"]')).toHaveText("Sales");
  }
  await page.getByRole("row").filter({ hasText: "Punjagutta sales staff" })
    .getByRole("button", { name: "Manage staff", exact: true }).click();
  const manageDialog = page.getByRole("dialog", { name: "Manage Punjagutta sales staff", exact: true });
  const manageAssignment = manageDialog.getByRole("combobox", { name: "Assigned branch and department", exact: true });
  await expect(manageAssignment).toHaveValue(hierarchy.branches[1].branchId);
  await expect(manageAssignment.locator("option:checked")).toHaveText("Punjagutta · Sales");
  await expect(manageAssignment).not.toContainText(business.name);
  await manageDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "CROSSBROWSER88", "Cross-Browser-Password");
  await nav(page, "Departments");
  await expandBranchGroups(page);
  await expect(departmentRows).toHaveCount(3);
  await departmentFilter.selectOption("sales");
  await expect(departmentRows).toHaveCount(2);
  await locationFilter.selectOption({ label: "Ameerpet" });
  await expect(departmentFilter).toHaveValue("");
  await expect(departmentRows).toHaveCount(2);
  await departmentFilter.selectOption("service");
  await expect(departmentRows).toHaveCount(1);
  await expect(departmentRows.locator('td[data-label="Branch"]')).toHaveCount(0);
  await expect(page.locator(".p-branch-group").filter({ has: departmentRows }).locator(".p-branch-toggle")).toContainText("Ameerpet");
  await expect(departmentRows.locator('td[data-label="Department"]')).toHaveText("Service");
  await expect(page.getByRole("region", { name: "Branch controls", exact: true })).toContainText("Ameerpet");
  await expect(page.getByRole("region", { name: "Branch controls", exact: true })).not.toContainText("Punjagutta");
  const departmentExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export departments", exact: true }).click();
  const departmentDownload = await departmentExport;
  const departmentWorkbook = unzipSync(await fs.readFile(await departmentDownload.path()));
  const departmentSheet = strFromU8(departmentWorkbook["xl/worksheets/sheet1.xml"]);
  const departmentWorkbookText = Object.values(departmentWorkbook).map((value) => strFromU8(value)).join(" ");
  expect((departmentSheet.match(/<row\b/g) || []).length).toBe(2);
  expect(departmentWorkbookText).toContain("Ameerpet");
  expect(departmentWorkbookText).toContain("Service");
  expect(departmentWorkbookText).not.toContain("Punjagutta");
  expect(departmentWorkbookText).not.toContain("Sales");
  await page.getByRole("textbox", { name: "Search Departments", exact: true }).fill("Sales");
  await expect(departmentRows).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export departments", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Search Departments", exact: true }).fill("");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(departmentFilter).toHaveValue("service");
  await expect(departmentRows).toHaveCount(1);
  await locationFilter.selectOption({ label: "Punjagutta" });
  await expect(departmentFilter).toHaveValue("");
  await expect(departmentFilter.locator('option[value="service"]')).toHaveCount(0);
  await expect(departmentRows).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("departments-filters-desktop.png"), fullPage: true });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  const branchControls = page.getByRole("region", { name: "Branch controls", exact: true });
  await expect(branchControls).toHaveCSS("background-color", "rgb(21, 40, 59)");
  await expect(branchControls.locator(".p-department-control")).toHaveCSS("background-color", "rgb(16, 30, 45)");
  await expect(branchControls.locator(".p-department-control")).toHaveCSS("color", "rgb(237, 240, 247)");
  const deleteBranch = branchControls.getByRole("button", { name: "Delete branch", exact: true });
  await expect(deleteBranch).toHaveCSS("background-color", "rgb(66, 38, 50)");
  await expect(deleteBranch).toHaveCSS("color", "rgb(255, 187, 196)");
  await deleteBranch.hover();
  await expect(deleteBranch).toHaveCSS("background-color", "rgb(88, 48, 64)");
  await page.screenshot({ path: info.outputPath("departments-dark-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("departments-filters-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav(page, "Department staff");
  await expect(locationFilter).toHaveValue("");
  await expect(departmentFilter).toHaveValue("");
  await locationFilter.selectOption({ label: "Ameerpet" });
  await expect(staffRows).toHaveCount(2);
  await departmentFilter.selectOption("service");
  await expect(staffRows).toHaveCount(1);
  await expect(staffRows).toContainText("Ameerpet service staff");
  await locationFilter.selectOption("");
  await departmentFilter.selectOption("sales");
  await expect(staffRows).toHaveCount(2);
  await expect(page.locator(".p-info")).toHaveCSS("background-color", "rgb(21, 40, 59)");
  await expect(page.locator(".p-info")).toHaveCSS("color", "rgb(185, 194, 211)");
  await page.screenshot({ path: info.outputPath("department-staff-dark-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("department-staff-filters-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(page.locator(".p-info")).toHaveCSS("background-color", "rgb(250, 251, 254)");
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out", exact: true }).click();
  const creationAuth = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const creationHeaders = { Authorization: `Bearer ${(await creationAuth.json()).token}` };
  const created = await page.request.post("/api/cards", { headers: creationHeaders, data: {
    businessId: business.businessId, branchId: hierarchy.branches[0].branchId,
    headline: "Sales reward", offerTitle: "15% OFF", description: "Your next visit",
    couponCode: "CROSS-LOCATION-BROWSER", customerPhone: "9876543210",
  } });
  expect(created.status()).toBe(201);
  const card = await created.json();
  expect((await page.request.post(`/api/cards/${card.slug}/claim`)).status()).toBe(200);
  await login(page, "CROSSBROWSER88", "Cross-Browser-Password");
  await nav(page, "Coupons");
  const couponRow = page.getByRole("row").filter({ hasText: "CROSS-LOCATION-BROWSER" });
  await expect(couponRow.locator('td[data-label="Branch"]')).toHaveText("Ameerpet");
  await expect(couponRow.locator('td[data-label="Department"]')).toHaveText("Sales");
  const couponExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  const exported = await couponExport;
  const couponWorkbook = unzipSync(await fs.readFile(await exported.path()));
  const couponWorkbookText = Object.values(couponWorkbook).map((value) => strFromU8(value)).join(" ");
  for (const value of ["Branch", "Department", "Ameerpet", "Sales"]) expect(couponWorkbookText).toContain(value);
  await page.screenshot({ path: info.outputPath("coupons-branch-column-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".p-sidebar").evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await expectResponsiveFit(page);
  await page.screenshot({ path: info.outputPath("coupons-branch-column-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "PJSALESTEST88", "Cross-Staff-Password");
  await expect(page.locator(".p-staff-location")).toHaveText("Branch: Punjagutta");
  await expect(page.locator(".p-workspace-assignment")).toHaveText("Branch: Punjagutta · Sales");
  await page.screenshot({ path: info.outputPath("staff-dashboard-assigned-branch.png") });
  await page.getByLabel("Coupon code", { exact: true }).fill("CROSS-LOCATION-BROWSER");
  await page.getByRole("main").getByRole("button", { name: "Redeem coupon", exact: true }).click();
  const popup = page.getByRole("alertdialog");
  await expect(popup.getByRole("heading", { name: "Coupon redeemed", exact: true })).toBeVisible();
  await expect(popup.locator(".p-result-details > div").filter({ has: page.locator("dt", { hasText: /^Issued branch$/ }) })).toContainText("Ameerpet");
  await expect(popup.locator(".p-result-details > div").filter({ has: page.locator("dt", { hasText: /^Redeemed branch$/ }) })).toContainText("Punjagutta");
  await expect(popup).toContainText("Punjagutta sales staff");
  await expect(popup).toContainText("Date & time");
  await page.screenshot({ path: info.outputPath("cross-location-redemption.png"), fullPage: true });
  await popup.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".p-staff-metrics article").filter({ hasText: "Total redeemed" }).locator("strong")).toHaveText("1");
  await nav(page, "Redemption history");
  await expect(page.getByRole("row").filter({ hasText: "CROSS-LOCATION-BROWSER" })).toBeVisible();
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "AMSALESTEST88", "Cross-Staff-Password");
  await expect(page.locator(".p-staff-location")).toHaveText("Branch: Ameerpet");
  await expect(page.locator(".p-workspace-assignment")).toHaveText("Branch: Ameerpet · Sales");
  await expect(page.locator(".p-staff-metrics article").filter({ hasText: "Total redeemed" }).locator("strong")).toHaveText("0");
  await nav(page, "Redemption history");
  await expect(page.getByRole("row").filter({ hasText: "CROSS-LOCATION-BROWSER" })).toHaveCount(0);
  await nav(page, "Redeem coupon");
  await page.getByLabel("Coupon code", { exact: true }).fill("CROSS-LOCATION-BROWSER");
  await page.getByRole("main").getByRole("button", { name: "Redeem coupon", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Coupon cannot be redeemed", exact: true })).toBeVisible();
  await expect(popup).toContainText("Punjagutta sales staff");
  await expect(popup).toContainText("Punjagutta");
  const cleanupAuth = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const cleanupHeaders = { Authorization: `Bearer ${(await cleanupAuth.json()).token}` };
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, { headers: cleanupHeaders, data: { confirmName: business.name } })).status()).toBe(200);
});

test("super admin can delete all coupons for one verified business only", async ({ page }) => {
  const rootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const rootHeaders = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const createdResponse = await page.request.post("/api/portal/businesses", { headers: rootHeaders, data: {
    name: "Coupon Cleanup Retail", loginId: "CLEANUP58", password: "Coupon-Cleanup-Password",
    limits: { card: 10, branch: 2, department: 2, account: 1 }, generateCredentials: true,
  } });
  expect(createdResponse.status()).toBe(201);
  const business = (await createdResponse.json()).business;
  const ownerLogin = await page.request.post("/api/auth/login", { data: { loginId: "CLEANUP58", password: "Coupon-Cleanup-Password" } });
  const ownerHeaders = { Authorization: `Bearer ${(await ownerLogin.json()).token}` };
  const cardResponse = await page.request.post("/api/cards", { headers: ownerHeaders, data: {
    businessId: business.businessId, headline: "Cleanup reward", offerTitle: "20% OFF",
    description: "Cleanup test", campaignName: "Cleanup", customerPhone: "9876543210",
  } });
  expect(cardResponse.status()).toBe(201);
  const card = await cardResponse.json();
  const secondCardResponse = await page.request.post("/api/cards", { headers: ownerHeaders, data: {
    businessId: business.businessId, headline: "Second cleanup reward", offerTitle: "30% OFF",
    description: "Cleanup test two", campaignName: "Cleanup", customerPhone: "9876543211",
  } });
  expect(secondCardResponse.status()).toBe(201);
  const secondCard = await secondCardResponse.json();

  await login(page, "platform@example.test", "Platform-Test-Password");
  await nav(page, "Businesses");
  const row = page.getByRole("row").filter({ hasText: business.name });
  await row.getByRole("button", { name: "Manage coupons", exact: true }).click();
  const manager = page.getByRole("dialog", { name: `Manage coupons · ${business.name}`, exact: true });
  await expect(manager).toBeVisible();
  await expect(manager.getByText("Total coupons").locator("..").locator("strong")).toHaveText("2");
  await expect(manager.getByText("Available", { exact: true }).locator("..").locator("strong")).toHaveText("2");
  await manager.getByLabel("Search coupons", { exact: true }).fill(card.couponCode);
  await expect(manager.getByRole("row").filter({ hasText: card.couponCode })).toBeVisible();
  await expect(manager.getByRole("row").filter({ hasText: secondCard.couponCode })).toHaveCount(0);
  await manager.getByLabel("Search coupons", { exact: true }).fill("");
  await manager.getByLabel("Coupon status", { exact: true }).selectOption("redeemed");
  await expect(manager.getByRole("row").filter({ hasText: card.couponCode })).toHaveCount(0);
  await manager.getByLabel("Coupon status", { exact: true }).selectOption("all");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await manager.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const firstCouponRow = manager.getByRole("row").filter({ hasText: card.couponCode });
  await firstCouponRow.getByRole("button", { name: "Delete", exact: true }).click();
  const singleDialog = page.getByRole("dialog", { name: `Delete coupon ${card.couponCode}`, exact: true });
  await singleDialog.getByLabel(`Type ${card.couponCode} to confirm`).fill(card.couponCode);
  await singleDialog.getByRole("button", { name: "Delete coupon permanently", exact: true }).click();
  await expect(singleDialog).not.toBeVisible();
  await expect(manager.getByText("Total coupons").locator("..").locator("strong")).toHaveText("1");
  await expect(firstCouponRow).toHaveCount(0);
  await manager.getByRole("button", { name: "Delete all coupons", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Delete all coupons for ${business.name}`, exact: true });
  await dialog.getByLabel(`Type ${business.name} to confirm`).fill("wrong");
  await dialog.getByRole("button", { name: "Delete all coupons", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Type the exact business name");
  await dialog.getByLabel(`Type ${business.name} to confirm`).fill(business.name);
  await dialog.getByRole("button", { name: "Delete all coupons", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("All coupons");
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Delete all coupons", exact: true })).toBeDisabled();
  expect((await page.request.get(`/api/cards/${card.slug}`)).status()).toBe(404);
  expect((await page.request.get(`/api/cards/${secondCard.slug}`)).status()).toBe(404);
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, {
    headers: rootHeaders, data: { confirmName: business.name },
  })).status()).toBe(200);
});

test("delete all businesses requires confirmation and keeps the Businesses page after refresh", async ({ page }, info) => {
  await login(page, "platform@example.test", "Platform-Test-Password");
  await nav(page, "Businesses");
  await page.getByRole("button", { name: "Delete all businesses", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete all businesses", exact: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Impact Vibes" })).toBeVisible();
  await page.getByRole("button", { name: "Delete all businesses", exact: true }).click();
  await dialog.getByLabel("Type DELETE ALL BUSINESSES to confirm").fill("wrong");
  await dialog.getByRole("button", { name: "Delete all businesses", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Type DELETE ALL BUSINESSES to confirm.");
  await dialog.getByLabel("Type DELETE ALL BUSINESSES to confirm").fill("DELETE ALL BUSINESSES");
  await page.screenshot({ path: info.outputPath("delete-all-businesses.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Delete all businesses", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("All businesses deleted.");
  await expect(page.getByRole("button", { name: "Delete all businesses", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Businesses");
  await expect(page.getByRole("button", { name: "Delete all businesses", exact: true })).toBeDisabled();
  await nav(page, "Overview");
  await expect(page.locator(".p-metrics article").filter({ hasText: "Total scratch cards" }).locator("strong")).toHaveText("0");
});
