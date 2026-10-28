import { test, expect } from "@playwright/test";
import sharp from "sharp";

export function registerBrandingTest() {
test("business brand settings show selected and fixed logos in previews and public cards", async ({ page }, info) => {
  const root = await page.request.post("/api/auth/login", { data: { loginId: "platform@example.test", password: "Platform-Test-Password" } });
  const headers = { Authorization: `Bearer ${(await root.json()).token}` };
  const created = await page.request.post("/api/portal/businesses", { headers, data: {
    name: "Brand Studio", loginId: "BRANDSTUDIO88", password: "Brand-Studio-Password",
    structureMode: "brand-department", cardImagesEnabled: true,
    limits: { card: 100, branch: 10, department: 10, account: 10 },
  } });
  expect(created.status()).toBe(201);
  const { business } = await created.json();
  const prefix = `/api/portal/businesses/${business.businessId}`;
  const hierarchyResponse = await page.request.post(`${prefix}/departments/branches`, { headers, data: { departments: [
    { name: "North", branches: [{ name: "Sales" }] }, { name: "South", branches: [{ name: "Service" }] },
  ] } });
  const hierarchy = await hierarchyResponse.json();
  const logo = async (name, color) => ({ name: `${name}.png`, mimeType: "image/png", buffer: await sharp(Buffer.from(
    `<svg width="180" height="90"><rect width="180" height="90" rx="12" fill="${color}"/><text x="90" y="57" text-anchor="middle" fill="white" font-size="34" font-family="Arial" font-weight="bold">${name}</text></svg>`)).png().toBuffer() });
  await page.goto("/");
  await page.getByLabel("Login ID", { exact: true }).fill("BRANDSTUDIO88");
  await page.getByLabel("Password", { exact: true }).fill("Brand-Studio-Password");
  await page.getByRole("button", { name: "Sign in to dashboard" }).click();
  const navigate = name => page.locator(".p-sidebar nav").getByRole("button", { name, exact: true }).click();
  await navigate("Card image settings");
  await expect(page.locator(".p-page-heading h1")).toHaveText("Card image settings");
  const fixed = page.locator(".brand-setting-card").filter({ has: page.getByRole("heading", { name: "Fixed brand", exact: true }) });
  const normal = page.locator(".brand-setting-card").filter({ has: page.getByRole("heading", { name: "Selectable brand", exact: true }) });
  await fixed.getByLabel("Brand name", { exact: true }).fill("Partner");
  await fixed.getByLabel("Brand image", { exact: true }).setInputFiles(await logo("PARTNER", "#e68000"));
  await fixed.getByRole("button", { name: "Save brand", exact: true }).click();
  await expect(fixed.getByRole("status")).toContainText("Brand saved");
  await normal.getByLabel("Brand name", { exact: true }).fill("North Brand");
  await normal.getByLabel("Brand image", { exact: true }).setInputFiles(await logo("NORTH", "#006c96"));
  await normal.getByRole("button", { name: "Save brand", exact: true }).click();
  await expect(normal.getByRole("status")).toContainText("Brand saved");
  await page.getByLabel("Select brand", { exact: true }).selectOption(hierarchy.departments[1].departmentId);
  await normal.getByLabel("Brand image", { exact: true }).setInputFiles(await logo("SOUTH", "#137a59"));
  await normal.getByRole("button", { name: "Save brand", exact: true }).click();
  await expect(normal.getByRole("status")).toContainText("Brand saved");
  await page.reload();
  await expect(fixed.getByLabel("Brand name", { exact: true })).toHaveValue("Partner");
  await expect(normal.getByLabel("Brand name", { exact: true })).toHaveValue("North Brand");
  // Check the server URL, not just the temporary FileReader preview.
  await expect(fixed.locator(".brand-upload-preview img")).toHaveJSProperty("naturalWidth", 180);
  await expect(normal.locator(".brand-upload-preview img")).toHaveJSProperty("naturalWidth", 180);
  for (const width of [1100, 1024, 900, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cardBounds = await fixed.boundingBox();
    expect(cardBounds.x).toBeGreaterThanOrEqual(0);
    expect(cardBounds.x + cardBounds.width).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("brand-settings-desktop.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("switch", { name: "Dark mode", exact: true }).click();
  await page.screenshot({ path: info.outputPath("brand-settings-dark.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("brand-settings-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("switch", { name: "Dark mode", exact: true }).click();
  await navigate("Branches & Departments");
  await expect(page.getByRole("heading", { name: "Branches & Departments", exact: true })).toBeVisible();
  await expect(page.locator(".p-branch-toggle").filter({ hasText: "North Brand" })).toBeVisible();
  const northRow = page.locator(".p-department-control").filter({ hasText: "North Brand" });
  await northRow.getByRole("button", { name: "Edit brand" }).click();
  const renameDialog = page.getByRole("dialog", { name: "Edit brand" });
  await renameDialog.getByLabel("Brand name").fill("North Studio");
  await renameDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".p-branch-toggle").filter({ hasText: "North Studio" })).toBeVisible();
  await page.locator(".p-department-control").filter({ hasText: "North Studio" }).getByRole("button", { name: "Edit brand" }).click();
  await page.getByRole("dialog", { name: "Edit brand" }).getByLabel("Brand name").fill("North Brand");
  await page.getByRole("dialog", { name: "Edit brand" }).getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".p-branch-toggle").filter({ hasText: "North Brand" })).toBeVisible();
  await navigate("Create scratch card");
  const select = page.getByLabel("Select brand", { exact: true });
  await select.selectOption(hierarchy.departments[0].departmentId);
  const preview = page.locator(".phone-brand .card-brand-header");
  await expect(preview.locator(".card-brand-left img")).toHaveAttribute("alt", "North Brand logo");
  await expect(preview.locator(".card-brand-right img")).toHaveAttribute("alt", "Partner logo");
  await select.selectOption(hierarchy.departments[1].departmentId);
  await expect(preview.locator(".card-brand-left img")).toHaveAttribute("alt", "South logo");
  await page.getByLabel("Selected brand logo size", { exact: true }).fill("135");
  await page.getByLabel("Fixed brand logo size", { exact: true }).fill("70");
  await expect(page.locator(".logo-size-controls output").nth(0)).toHaveText("135%");
  await expect(page.locator(".logo-size-controls output").nth(1)).toHaveText("70%");
  expect(await preview.locator(".card-brand-left").evaluate(element =>
    getComputedStyle(element).getPropertyValue("--brand-logo-scale").trim())).toBe("1.35");
  expect(await preview.locator(".card-brand-right").evaluate(element =>
    getComputedStyle(element).getPropertyValue("--brand-logo-scale").trim())).toBe("0.7");
  const assertOrder = async header => {
    const left = await header.locator(".card-brand-left").boundingBox();
    const middle = await header.locator(".card-business-name").boundingBox();
    const right = await header.locator(".card-brand-right").boundingBox();
    expect(left.x + left.width).toBeLessThanOrEqual(middle.x);
    expect(middle.x + middle.width).toBeLessThanOrEqual(right.x);
    for (const img of await header.locator("img").all()) await expect(img).toHaveJSProperty("naturalWidth", 180);
  };
  await assertOrder(preview);
  await page.screenshot({ path: info.outputPath("brand-creator-desktop.png"), fullPage: true, animations: "disabled" });
  await page.locator('input[name="customerPhone"]').fill("9876543210");
  const saved = page.waitForResponse(response => response.url().endsWith("/api/cards") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create scratch-card link", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const card = await response.json();
  await page.goto(`/card/${card.slug}`);
  const header = page.locator(".recipient-topbar .card-brand-header");
  await expect(header.locator(".card-business-name")).toHaveText("Brand Studio");
  await expect(header.locator(".card-brand-left b")).toHaveCount(0);
  await expect(header.locator(".card-brand-right b")).toHaveCount(0);
  await expect(header.locator(".card-brand-left img")).toHaveAttribute("alt", "South logo");
  await expect(header.locator(".card-brand-right img")).toHaveAttribute("alt", "Partner logo");
  expect(await header.locator(".card-brand-left").evaluate(element =>
    getComputedStyle(element).getPropertyValue("--brand-logo-scale").trim())).toBe("1.35");
  expect(await header.locator(".card-brand-right").evaluate(element =>
    getComputedStyle(element).getPropertyValue("--brand-logo-scale").trim())).toBe("0.7");
  await assertOrder(header);
  await page.screenshot({ path: info.outputPath("brand-public-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertOrder(header);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("brand-public-mobile.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Updating settings cannot change a previously issued card.
  await page.request.patch(`${prefix}/brand-settings`, { headers, data: { fixed: { name: "New partner", image: "" } } });
  await page.reload();
  await expect(header.locator(".card-brand-right img")).toHaveAttribute("alt", "Partner logo");
  // A missing logo must not leave a broken-image icon or repeat its alt text.
  const failLogos = route => route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
  await page.route("**/api/brand-images/**", failLogos);
  await page.goto("/?tab=Card%20image%20settings");
  const settingsHeader = page.locator(".brand-header-preview .card-brand-header");
  await expect(settingsHeader.locator(".card-brand-left .brand-logo-placeholder svg")).toBeVisible();
  await expect(settingsHeader.locator(".card-brand-left img")).toHaveCount(0);
  await expect(settingsHeader.locator(".card-brand-left")).toHaveText("North Brand");
  await expect(normal.getByRole("button", { name: "Retry image", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("brand-logo-failed-desktop.png"), fullPage: true, animations: "disabled" });
  await page.goto(`/card/${card.slug}`);
  await expect(header.locator(".brand-logo-placeholder")).toHaveCount(2);
  await expect(header.locator("img")).toHaveCount(0);
  await expect(header.locator(".card-brand-left")).toHaveText("South");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("brand-logo-failed-mobile.png"), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?tab=Card%20image%20settings");
  await expect(normal.getByRole("button", { name: "Retry image", exact: true })).toBeVisible();
  await page.unroute("**/api/brand-images/**", failLogos);
  await normal.getByRole("button", { name: "Retry image", exact: true }).click();
  await expect(settingsHeader.locator(".card-brand-left img")).toHaveJSProperty("naturalWidth", 180);
  await expect(normal.locator(".brand-upload-preview img")).toHaveJSProperty("naturalWidth", 180);
  await expect(normal.locator(".brand-image-notice")).toHaveCount(0);
  // Saving must not report success if the published image cannot be fetched.
  await page.route("**/api/brand-images/**", failLogos);
  await fixed.getByLabel("Brand name", { exact: true }).fill("Verified partner");
  await fixed.getByLabel("Brand image", { exact: true }).setInputFiles(await logo("VERIFIED", "#d46d00"));
  await fixed.getByRole("button", { name: "Save brand", exact: true }).click();
  await expect(fixed.getByRole("alert")).toContainText("saved logo could not be loaded (HTTP 404)");
  await expect(fixed.getByRole("status")).toHaveCount(0);
  // Keep the chosen file so a retry can repair the same image without reselecting it.
  await page.unroute("**/api/brand-images/**", failLogos);
  await fixed.getByRole("button", { name: "Save brand", exact: true }).click();
  await expect(fixed.getByRole("status")).toContainText("Brand saved");
  await page.reload();
  await expect(fixed.locator(".brand-upload-preview img")).toHaveJSProperty("naturalWidth", 180);
  await expect(settingsHeader.locator(".card-brand-right img")).toHaveJSProperty("naturalWidth", 180);
  await page.request.delete(prefix, { headers, data: { confirmName: business.name } });
});
}
