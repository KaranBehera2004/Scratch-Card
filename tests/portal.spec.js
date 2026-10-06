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
  await expect(
    page.getByRole("heading", { name: "This coupon has already been used." }),
  ).toBeVisible();
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
