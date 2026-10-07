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
    .getByRole("button", { name, exact: true })
    .click();
const createdCredentials = async (page) => {
  const popup = page.getByRole("dialog", { name: "Login credentials", exact: true });
  await expect(popup).toBeVisible();
  const credentials = {
    loginId: await popup.getByLabel("Login ID", { exact: true }).inputValue(),
    password: await popup.getByLabel("Password", { exact: true }).inputValue(),
  };
  expect(credentials.loginId).toMatch(/^(biz|user|sa)-[a-f0-9]{20}$/);
  expect(credentials.password.length).toBeGreaterThanOrEqual(24);
  await popup.getByRole("button", { name: "Done", exact: true }).click();
  await expect(popup).not.toBeVisible();
  return credentials;
};

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
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await expect(dialog.getByLabel("Branch limit", { exact: true })).toHaveValue(
    "2",
  );
  await expect(dialog.getByLabel("Business account limit")).toHaveValue("1");
  await expect(
    dialog.getByRole("combobox", { name: "Subscription plan" }),
  ).toHaveCount(0);
  await dialog.getByLabel("Scratch-card limit").fill("250");
  await dialog.getByLabel("Branch limit", { exact: true }).fill("4");
  await dialog.getByLabel("Business account limit").fill("3");
  await page.screenshot({
    path: info.outputPath("business-limits.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save changes" }).click();
  const orbitCredentials = await createdCredentials(page);
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Orbit Retail" }),
  ).toBeVisible();
  const businessRow = page.getByRole("row").filter({ hasText: "Orbit Retail" });
  await expect(businessRow).toContainText(orbitCredentials.loginId);
  await expect(businessRow).toContainText("250 scratch cards");
  await expect(businessRow).toContainText("4 branches");
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
  await expect(dialog.getByLabel("Branch limit", { exact: true })).toHaveValue(
    "4",
  );
  await dialog.getByLabel("Branch limit", { exact: true }).fill("2");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(businessRow).toContainText("2 branches");
  await page
    .getByRole("row")
    .filter({ hasText: "Impact Vibes" })
    .getByRole("button", { name: "Open workspace" })
    .click();
  await expect(page.locator(".p-workspace-banner")).toContainText(
    "Impact Vibes",
  );
  await nav(page, "Branches");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  await dialog.getByLabel("Branch name").fill("Hyderabad");
  await dialog.getByLabel("Address").fill("Jubilee Hills");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("cell", { name: "Hyderabad", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to super admin" }).click();
  await nav(page, "Business accounts");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Business", exact: true })
    .selectOption("impact-vibes");
  await dialog.getByLabel("Full name").fill("Rewards Editor");
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
  await expect(page.locator(".scratch-card .offer-branch")).toHaveText("All branches");
  await page.getByLabel("Campaign name").fill("Diwali rewards");
  await page
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption({ label: "Hyderabad" });
  await expect(page.locator(".phone-brand")).toHaveText("✦ Impact Vibes");
  await expect(page.locator(".scratch-card .offer-branch")).toHaveText("Hyderabad");
  await expect(page.getByRole("combobox", { name: "Branch", exact: true })).toHaveCount(1);
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
  const shareUrl = await page
    .getByRole("textbox", { name: "Share link", exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Create another" }).click();
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
  for (const tab of [
    "Campaigns",
    "Scratch cards",
    "Branches",
    "Business accounts",
    "Analytics",
    "Security",
    "Audit",
    "Platform settings",
  ]) {
    await nav(page, tab);
    await expect(page.locator(".p-page-heading h1")).toHaveText(tab);
    await expect(page.locator(".p-alert.error")).toHaveCount(0);
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
  const box = await page.locator(".scratch-card canvas").boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  for (let y = 15; y < box.height; y += 22) {
    await page.mouse.move(box.x + 10, box.y + y);
    await page.mouse.move(box.x + box.width - 10, box.y + y, { steps: 12 });
  }
  await page.mouse.up();
  await expect(page.getByText("Offer unlocked!")).toBeVisible();
  await expect(page.locator(".scratch-card .offer-branch")).toHaveText("Hyderabad");
  await page.reload();
  await expect(page.locator(".scratch-card canvas")).toHaveCount(0);
  await expect(page.locator(".scratch-card .offer-content b")).toBeVisible();
  expect(errors).toEqual([]);
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
  await page.getByLabel("Default branch limit").fill("5");
  await page.getByLabel("Default business account limit").fill("2");
  await page.getByRole("button", { name: "Save platform settings" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved successfully.");
  await page.reload();
  await expect(page.locator(".p-page-heading h1")).toHaveText("Platform settings");
  await expect(page.getByLabel("Default branch limit")).toHaveValue("5");
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
  await expect(dialog.getByLabel("Branch limit", { exact: true })).toHaveValue("5");
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
    "Branches",
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
  await nav(page, "Create scratch card");
  await expect(
    page.getByRole("combobox", { name: "Branch", exact: true }),
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
    { code: "hi", nav: ["अवलोकन", "स्क्रैच कार्ड बनाएँ", "अभियान", "कूपन", "शाखाएँ"],
      workspace: "Impact Vibes कार्यक्षेत्र", available: "उपलब्ध इनाम", signOut: "साइन आउट",
      cardLanguage: "कार्ड की भाषा", campaign: "अभियान का नाम", branch: "शाखा", allBranches: "सभी शाखाएँ",
      preview: "पूर्वावलोकन", previewTitle: "स्क्रैच-कार्ड पूर्वावलोकन", closePreview: "पूर्वावलोकन बंद करें",
      add: "शाखा जोड़ें", branchName: "शाखा का नाम", address: "पता", save: "बदलाव सहेजें", cancel: "रद्द करें",
      branchError: "शाखा का नाम ज़रूरी है।", edit: "संपादित करें", editTitle: "शाखा संपादित करें",
      success: "बदलाव सफलतापूर्वक सहेजे गए।", empty: "कोई रिकॉर्ड नहीं मिला", header: "इनाम और कूपन", exportHeader: "कूपन कोड" },
    { code: "te", nav: ["అవలోకనం", "స్క్రాచ్ కార్డ్ సృష్టించండి", "ప్రచారాలు", "కూపన్లు", "శాఖలు"],
      workspace: "Impact Vibes కార్యస్థలం", available: "అందుబాటులో ఉన్న బహుమతులు", signOut: "సైన్ అవుట్",
      cardLanguage: "కార్డ్ భాష", campaign: "ప్రచారం పేరు", branch: "శాఖ", allBranches: "అన్ని శాఖలు",
      preview: "ప్రివ్యూ", previewTitle: "స్క్రాచ్ కార్డ్ ప్రివ్యూ", closePreview: "ప్రివ్యూను మూసివేయండి",
      add: "శాఖను జోడించండి", branchName: "శాఖ పేరు", address: "చిరునామా", save: "మార్పులను సేవ్ చేయండి", cancel: "రద్దు చేయండి",
      branchError: "శాఖ పేరు అవసరం.", edit: "సవరించండి", editTitle: "శాఖను సవరించండి",
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
    await expect(page.locator(".offer-branch")).toHaveText("All branches");
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

test("generated credentials popup copies business and super-admin logins and shows passwords only once", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page, "platform@example.test", "Platform-Test-Password");
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await nav(page, "Businesses");
  await page.getByRole("button", { name: "Create business", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Create business workspace" });
  await expect(editor.getByRole("textbox", { name: "Owner login email" })).toHaveCount(0);
  await expect(editor.locator('input[type="password"]')).toHaveCount(0);
  await editor.getByLabel("Business name", { exact: true }).fill("Credentials Test Shop");
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
  await page.getByRole("dialog").getByLabel("Full name", { exact: true }).fill("Credentials Test Admin");
  await page.getByRole("dialog").getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Credentials Test Admin");
  const adminCredentials = await createdCredentials(page);
  expect(adminCredentials.loginId).not.toBe(credentials.loginId);
  expect(adminCredentials.password).not.toBe(credentials.password);
  await expect(page.getByRole("row").filter({ hasText: "Credentials Test Admin" })).toContainText(adminCredentials.loginId);
  await page.locator(".p-topbar").getByRole("button", { name: "Sign out" }).click();
  await login(page, adminCredentials.loginId, adminCredentials.password);
  await expect(page.locator(".p-welcome-row h1")).toHaveText("Your rewards platform, at a glance.");
  await expect(page.locator(".p-sidebar nav").getByRole("button", { name: "Super admins", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".p-welcome-row h1")).toBeVisible();
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
  const publicCard = cards.find(card => !card.disabled && !card.expiresAt);
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
  await page.getByRole("combobox", { name: "Branch", exact: true }).selectOption(branch.branchId);
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
  expect(redemption.status()).toBe(200);
  await publicPage.close();
  await nav(page, "Campaigns");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  const campaignRows = page.getByRole("row").filter({ hasText: "Branch reporting test" });
  await expect(campaignRows).toHaveCount(2);
  const assignedRow = campaignRows.filter({ hasText: "Hyderabad" });
  await expect(assignedRow.locator('[data-label="Scratch cards"]')).toHaveText("2");
  await expect(assignedRow.locator('[data-label="Redeemed"]')).toHaveText("1");
  await expect(campaignRows.filter({ hasText: "All branches" }).locator('[data-label="Scratch cards"]')).toHaveText("1");
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
  const createRequests = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/cards") createRequests.push(request.url());
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
  expect(whatsappUrl.origin).toBe("https://wa.me");
  expect(whatsappUrl.pathname).toBe("/447700900123");
  expect(whatsappUrl.searchParams.get("text")).toContain(url);
  await page.getByRole("button", { name: "Share on WhatsApp", exact: true }).click();
  expect((await page.evaluate(() => window.__whatsappCalls)).at(-1).url).toBe(whatsappUrl.href);
  await page.getByRole("button", { name: "Create another" }).click();
  await expect(whatsappInput).toHaveValue("");
  await whatsappInput.fill("9876543212");
  await page.getByLabel("Expiry date (optional)").fill("");
  await page.evaluate(() => window.open = () => null);
  await page.getByRole("button", { name: "Direct send", exact: true }).click();
  await expect(shareLink).toBeVisible();
  await expect(page.locator(".modal .copied")).toContainText("WhatsApp could not open");
  await page.getByRole("button", { name: "Create another" }).click();
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
      expect((await page.request.post(`/api/portal/cards/${result.slug}/redeem`, { headers, data: { branchId: sample.branchId } })).status()).toBe(200);
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
  const branchFilter = page.getByLabel("Filter by branch", { exact: true });
  const campaignFilter = page.getByLabel("Filter by campaign", { exact: true });
  const dateFilter = page.getByLabel("Created date range", { exact: true });
  const sampleRows = page.getByRole("row").filter({ hasText: "FILTER-TEST-" });
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
  const search = page.getByLabel("Search Branches", { exact: true });
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
    expect(workbook.filename).toContain(`branches-${language}`);
    expect(workbook.text).toContain(header);
    expect(workbook.text).toContain(branchList[0].name);
    expect(workbook.text).toContain(branchList[0].address);
    expect(workbook.text).not.toContain(branchList[1].name);
    expect((workbook.sheet.match(/<row\b/g) || []).length).toBe(2);
  }
  await page.locator(".p-topbar select").selectOption("en");
  await search.fill("no-matching-export-branch");
  await expect(page.getByRole("button", { name: "Export branches", exact: true })).toBeDisabled();
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
  await nav(page, "Branches");
  await page.getByLabel("Search Branches", { exact: true }).fill(branchList[0].name);
  const visibleRows = await page.locator(".p-table-scroll tbody tr").count();
  const adminWorkbook = await readWorkbook();
  expect(adminWorkbook.filename).toContain("branches-en");
  expect(adminWorkbook.text).toContain("Impact Vibes");
  expect((adminWorkbook.sheet.match(/<row\b/g) || []).length).toBe(visibleRows + 1);
});

test("bulk creator recovers retries, previews branches, redeems at the assigned branch and exports every page", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const rootHeaders = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers: rootHeaders, data: { name: "Bulk Test Business", limits: { card: 75, branch: 3, account: 1 } } });
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
  await page.getByRole("button", { name: "+ Add Branch", exact: true }).click();
  await page.getByRole("button", { name: "+ Add Branch", exact: true }).click();
  await expect(page.getByLabel("Bulk branch 2").locator(`option[value="${branches[0].branchId}"]`)).toHaveAttribute("disabled", "");
  await expect(page.getByRole("button", { name: "Generate 75 Coupons", exact: true })).toBeEnabled();
  await expect(page.locator(".bulk-summary")).toContainText("Total: 75 coupons");
  await page.locator(".bulk-branch-row").nth(2).getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".phone .offer-branch")).toHaveText("Madhapur");
  await expect(page.locator(".phone-brand")).toContainText("Bulk Test Business");
  await page.getByLabel("Remove branch row 3").click();
  await expect(page.getByRole("button", { name: "Generate 50 Coupons", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "+ Add Branch", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Bulk Generate", exact: true })).toHaveAttribute("aria-pressed", "true");
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
  await results.getByLabel("Filter batch by branch").selectOption(branches[2].branchId);
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
  for (const header of ["Branch", "Coupon Code", "Main Offer", "Offer Details", "Campaign Name", "Scratch Link", "Expiry Date", "Status", "Created At"])
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
  expect((await page.request.post(`/api/cards/${card.slug}/claim`, { data: {} })).status()).toBe(200);
  expect((await page.request.post(`/api/portal/cards/${card.slug}/redeem`, { headers, data: { branchId: branches[1].branchId } })).status()).toBe(403);
  await nav(page, "Coupons");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: card.couponCode });
  await row.getByRole("button", { name: "Redeem", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Redeem coupon", exact: true });
  await expect(dialog.getByLabel("Redemption branch")).toHaveValue(branches[0].branchId);
  await expect(dialog.getByLabel("Redemption branch").locator("option")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row.locator(".p-badge")).toHaveText("redeemed");
  expect((await page.request.get("/api/portal/cards", { headers })).ok()).toBe(true);
  const cards = (await (await page.request.get("/api/portal/cards", { headers })).json()).cards;
  expect(cards).toHaveLength(75);
  await page.goto(`/card/${card.slug}`);
  await expect(page.getByRole("heading", { name: "This coupon has already been used." })).toBeVisible();
  expect(errors).toEqual([]);
  expect((await page.request.delete(`/api/portal/businesses/${business.businessId}`, { headers: rootHeaders, data: { confirmName: "Bulk Test Business" } })).status()).toBe(200);
});

test("batch WhatsApp sharing exports every coupon and opens one chat for manual Excel attachment", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const rootLogin = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const rootHeaders = { Authorization: `Bearer ${(await rootLogin.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers: rootHeaders,
    data: { name: "Batch Excel Share Business", limits: { card: 40, branch: 2, account: 1 } } });
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
  await results.getByLabel("Filter batch by branch").selectOption(branches[1].branchId);
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
  const dialog = page.getByRole("dialog", { name: "Send batch Excel via WhatsApp", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Recipient WhatsApp number", { exact: true })).toHaveValue("");
  const submit = dialog.getByRole("button", { name: "Download Excel & open WhatsApp", exact: true });
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
  const requiredHeaders = ["Branch", "Coupon Code", "Main Offer", "Offer Details", "Campaign Name", "Scratch Link", "Expiry Date", "Status", "Created At", "WhatsApp Number"];
  expect(workbook.rows[0].values).toEqual(expect.arrayContaining(requiredHeaders));
  expect(workbook.rows[0].values.filter(Boolean)).toHaveLength(10);
  const headerIndex = Object.fromEntries(workbook.rows[0].values.map((header, index) => [header, index]));
  for (const card of batch.coupons) {
    const row = workbook.rows.find(row => row.values[headerIndex["Coupon Code"]] === card.couponCode);
    expect(row).toBeTruthy();
    expect(row.values[headerIndex.Branch]).toBe(card.branchName);
    expect(row.values[headerIndex["WhatsApp Number"]]).toBe(card.customerPhone);
    expect(row.values[headerIndex["Scratch Link"]]).toBe(`http://127.0.0.1:5099/card/${card.slug}`);
    for (const name of ["Coupon Code", "Scratch Link", "WhatsApp Number"]) expect(row.types[headerIndex[name]]).toMatch(/^(s|inlineStr)$/);
  }
  expect(workbook.rows.find(row => row.values[headerIndex["Coupon Code"]] === firstCard.couponCode).values[headerIndex.Status].toLowerCase()).toBe("scratched");
  const calls = await page.evaluate(() => window.__batchChatCalls);
  expect(calls.map(call => call.action)).toEqual(["open", "navigate"]);
  expect(calls[0].url).toBe("about:blank");
  const url = new URL(calls[1].url);
  expect(url.origin).toBe("https://wa.me"); expect(url.pathname).toBe("/447700900123");
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
  await expect(dialog.getByRole("button", { name: "Open WhatsApp chat", exact: true })).toBeEnabled();
  expect(downloads).toHaveLength(2);
  await mockWindow();
  await dialog.getByRole("button", { name: "Open WhatsApp chat", exact: true }).click();
  const recoveryCalls = await page.evaluate(() => window.__batchChatCalls);
  expect(recoveryCalls.filter(call => call.action === "navigate")).toHaveLength(1);
  expect(new URL(recoveryCalls.find(call => call.action === "navigate").url).pathname).toBe("/919876543210");
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
    data: { name: "Bulk Branch Controls Business", limits: { card: 75, branch: 2, account: 1 } },
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
  const addRow = page.getByRole("button", { name: "+ Add Branch", exact: true });
  const createBranch = page.getByRole("button", { name: "Create new branch", exact: true });
  await expect(addRow).toBeDisabled();
  await expect(page.getByText("All active branches are already in this batch. Create or activate another branch to add a row.", { exact: true })).toBeVisible();
  await expect(createBranch).toBeEnabled();
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
  await expect(createBranch).toBeEnabled();
  await expect(page.getByRole("button", { name: "All requested coupons generated", exact: true })).toBeDisabled();
  await createBranch.click();
  const dialog = page.getByRole("dialog", { name: "Add branch", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Branch name", { exact: true }).fill("Service");
  await dialog.getByLabel("Address", { exact: true }).fill("Second location");
  const branchSaved = page.waitForResponse(response => response.url().endsWith(`/businesses/${business.businessId}/branches`) && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  const savedResponse = await branchSaved;
  expect(savedResponse.status()).toBe(201);
  const service = (await savedResponse.json()).branch;
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Bulk Generate", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue("30% OFF");
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue("Branch draft remains intact");
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Bulk branch 1", { exact: true })).toHaveValue(sales.branchId);
  await expect(page.getByLabel("Bulk branch 2", { exact: true })).toHaveValue(service.branchId);
  await expect(page.getByLabel("Coupon quantity 2", { exact: true })).toHaveValue("25");
  await expect(page.getByLabel("Bulk branch 2", { exact: true }).locator(`option[value="${sales.branchId}"]`)).toHaveAttribute("disabled", "");
  await expect(results.locator("tbody tr")).toHaveCount(3);
  await expect(createBranch).toBeDisabled();
  await expect(page.getByText("Branch limit reached (2). Contact your administrator to increase it.", { exact: true })).toBeVisible();
  const savedBusiness = (await (await page.request.get("/api/portal/businesses", { headers })).json()).businesses[0];
  expect(savedBusiness.limits.branch).toBe(2);
  expect(savedBusiness.branches).toHaveLength(2);

  await page.getByLabel("Remove branch row 2", { exact: true }).click();
  await expect(addRow).toBeEnabled();
  await addRow.click();
  await expect(page.getByLabel("Bulk branch 2", { exact: true })).toHaveValue(service.branchId);
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
  await expect(page.getByLabel("Remove branch row 2", { exact: true })).toBeDisabled();
  await page.reload();
  await expect(results.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue("30% OFF");
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue("Branch draft remains intact");
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Coupon quantity 2", { exact: true })).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Retry saved batch", exact: true })).toBeEnabled();
  await results.getByLabel("Filter batch by branch").selectOption(sales.branchId);
  const retryResponse = page.waitForResponse(response => response.url().endsWith("/api/cards/bulk") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Retry saved batch", exact: true }).click();
  const second = await (await retryResponse).json();
  expect(second.replayed).toBe(true);
  expect(second.batchId).toBe(lostBatch.batchId);
  await expect(results).toContainText("5 coupons saved in this draft");
  await expect(results.getByLabel("Filter batch by branch")).toHaveValue(sales.branchId);
  await expect(results.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByLabel("Coupon quantity 1", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Remove branch row 2", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Main offer", { exact: true })).toHaveValue("30% OFF");
  await results.getByLabel("Filter batch by branch").selectOption(service.branchId);
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
  await expect(page.getByLabel("Remove branch row 2", { exact: true })).toBeEnabled();
  await results.getByLabel("Filter batch by branch").selectOption(sales.branchId);
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
  const shareDialog = page.getByRole("dialog", { name: "Send batch Excel via WhatsApp", exact: true });
  await shareDialog.getByLabel("Recipient WhatsApp number", { exact: true }).fill("9876543210");
  await shareDialog.getByLabel("I have permission to share these coupons and contact details with this number", { exact: true }).check();
  const shareSubmit = shareDialog.getByRole("button", { name: "Download Excel & open WhatsApp", exact: true });
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
  expect(new URL(chats.find(call => call.action === "navigate").url).pathname).toBe("/919876543210");
  await shareDialog.getByRole("button", { name: "Close dialog", exact: true }).last().click();
  await page.getByLabel("Remove branch row 1", { exact: true }).click();
  await addRow.click();
  await expect(page.getByLabel("Bulk branch 2", { exact: true })).toHaveValue(sales.branchId);
  await expect(page.getByRole("button", { name: "Generate 22 Coupons", exact: true })).toBeEnabled();
  await page.getByLabel("Coupon quantity 2", { exact: true }).fill("3");
  await expect(page.getByRole("button", { name: "All requested coupons generated", exact: true })).toBeDisabled();
  await expect(createBranch).toBeDisabled();
  const savedCards = (await (await page.request.get("/api/portal/cards", { headers })).json()).cards;
  expect(savedCards).toHaveLength(7);
  expect(savedCards.every(card => card.offerTitle === "30% OFF" && card.campaignName === "Branch draft remains intact")).toBe(true);
  expect(errors).toEqual([]);
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
