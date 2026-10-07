import test from "node:test";
import assert from "node:assert/strict";
import { branchQuantityError, bulkExcelRows, BULK_EXCEL_HEADERS, shareExcelRows, SHARE_EXCEL_HEADERS, unusedBulkBranches, addBulkBranch, mergeBulkResults, generatedByBranch, remainingBranchQuantities } from "./bulk-coupons.js";
import writeExcelFile from "write-excel-file/universal";
import { unzipSync, strFromU8 } from "fflate";
test("bulk client quantities require distinct branches and positive integers", () => {
  for (const quantity of [0, -1, "1.5", "1e2", "", 1001]) assert.ok(branchQuantityError([{ branchId: "a", quantity }]));
  assert.ok(branchQuantityError([{ branchId: "a", quantity: 25 }, { branchId: "a", quantity: 25 }]));
  assert.equal(branchQuantityError([{ branchId: "a", quantity: "25" }, { branchId: "b", quantity: 25 }]), "");
});
test("branch rows use actual unselected branches, not the number of rows", () => {
  const active = [{ branchId: "sales" }, { branchId: "service" }];
  assert.deepEqual(unusedBulkBranches([{ branchId: "sales", quantity: 3 }], active), [active[1]]);
  assert.deepEqual(unusedBulkBranches([{ branchId: "paused", quantity: 25 }, { branchId: "sales", quantity: 3 }], active), [active[1]]);
  assert.deepEqual(unusedBulkBranches([{ branchId: "sales" }, { branchId: "service" }], active), []);
  assert.deepEqual(unusedBulkBranches([], active), active);
});
test("new branches fill an empty row or append 25 coupons without duplicates or draft loss", () => {
  const rows = [{ branchId: "sales", quantity: 3 }];
  assert.deepEqual(addBulkBranch(rows, "service"), [...rows, { branchId: "service", quantity: 25 }]);
  assert.strictEqual(addBulkBranch(rows, "sales"), rows);
  assert.strictEqual(addBulkBranch(rows, ""), rows);
  assert.deepEqual(addBulkBranch([{ branchId: "", quantity: 7 }], "sales"), [{ branchId: "sales", quantity: 7 }]);
  const added = addBulkBranch(rows, "service");
  assert.strictEqual(addBulkBranch(added, "service"), added);
});
test("continuous branch quantities generate only the missing coupons, including after retries or re-adding a branch", () => {
  const coupons = Array.from({ length: 25 }, (_, index) => ({ slug: `sales-${index}`, branchId: "sales" }));
  const rows = [{ branchId: "sales", quantity: 25 }, { branchId: "service", quantity: 25 }];
  assert.deepEqual(remainingBranchQuantities(rows, coupons), [{ branchId: "service", quantity: 25 }]);
  assert.deepEqual(remainingBranchQuantities([{ branchId: "sales", quantity: 30 }], coupons), [{ branchId: "sales", quantity: 5 }]);
  assert.deepEqual(remainingBranchQuantities([{ branchId: "sales", quantity: 25 }], [...coupons, coupons[0]]), []);
  assert.equal(generatedByBranch([...coupons, coupons[0]]).get("sales"), 25);
  assert.ok(branchQuantityError([{ branchId: "sales", quantity: 24 }], coupons));
  const thousand = Array.from({ length: 1000 }, (_, index) => ({ slug: `saved-${index}`, branchId: "sales" }));
  assert.equal(branchQuantityError([{ branchId: "sales", quantity: 1000 }, { branchId: "service", quantity: 25 }], thousand), "");
  assert.ok(branchQuantityError([{ branchId: "sales", quantity: 1000 }, { branchId: "service", quantity: 1001 }], thousand));
  assert.deepEqual(remainingBranchQuantities([], coupons), []);
});
test("continuous results keep every generation once and use refreshed coupon statuses", () => {
  const first = { batchId: "workspace:first", coupons: [{ slug: "a", branchId: "sales", status: "available" }] };
  const second = { batchId: "workspace:second", coupons: [{ slug: "b", branchId: "service", status: "available" }] };
  const all = mergeBulkResults([first, second, second]);
  assert.deepEqual(all.batchIds, [first.batchId, second.batchId]);
  assert.equal(all.savedCount, 2);
  assert.equal(all.batchId, first.batchId);
  const replay = mergeBulkResults([all, { ...first, replayed: true, coupons: [{ ...first.coupons[0], status: "redeemed" }] }]);
  assert.equal(replay.savedCount, 2);
  assert.equal(replay.coupons[0].status, "redeemed");
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.batchIds, all.batchIds);
  assert.equal(bulkExcelRows(replay.coupons, "https://example.test").length, 2);
});
test("Excel maps every batch coupon, with codes and links explicitly typed as text", () => {
  const cards = Array.from({ length: 75 }, (_, index) => ({ branchName: "Ameerpet", couponCode: `000${index}`,
    slug: `slug${index}`, offerTitle: "25% OFF", description: "Next order", campaignName: "Summer", status: "available", createdAt: "2026-01-01T12:00:00Z" }));
  const rows = bulkExcelRows(cards, "https://example.test");
  assert.equal(rows.length, 75); assert.equal(BULK_EXCEL_HEADERS.length, 9);
  assert.deepEqual(rows[0][1], { value: "0000", type: String });
  assert.deepEqual(rows[74][5], { value: "https://example.test/card/slug74", type: String });
  assert.equal(rows[0][6].value, "");
});
function sharingCards() {
  return Array.from({ length: 75 }, (_, index) => ({
    branchName: ["Ameerpet", "Kukatpally", "Madhapur"][Math.floor(index / 25)],
    couponCode: `000${index}`, slug: `share${index}`, offerTitle: "25% OFF", description: "Next order",
    campaignName: "Summer", customerPhone: index === 74 ? undefined : `+91987654${String(index).padStart(4, "0")}`,
    status: "available", expiresAt: index === 0 ? "2026-11-01T12:00:00Z" : undefined,
    createdAt: "2026-10-07T12:00:00Z",
  }));
}
test("sharing Excel contains every coupon and each private assigned number, with text-safe codes and links", () => {
  const cards = sharingCards();
  const rows = shareExcelRows(cards, "https://example.test");
  assert.equal(rows.length, 75);
  assert.equal(SHARE_EXCEL_HEADERS.length, 10);
  assert.deepEqual(SHARE_EXCEL_HEADERS, ["Branch", "Coupon Code", "WhatsApp Number", "Main Offer", "Offer Details", "Campaign Name", "Scratch Link", "Expiry Date", "Status", "Created At"]);
  assert.deepEqual(rows[0][1], { value: "0000", type: String, format: "@" });
  assert.deepEqual(rows[0][2], { value: cards[0].customerPhone, type: String, format: "@" });
  assert.deepEqual(rows[26][2], { value: cards[26].customerPhone, type: String, format: "@" });
  assert.deepEqual(rows[74][2], { value: "", type: String, format: "@" });
  assert.deepEqual(rows[74][6], { value: "https://example.test/card/share74", type: String, format: "@" });
  assert.deepEqual(rows.map(row => row[0].value), cards.map(card => card.branchName));
  assert.deepEqual(rows.map(row => row[1].value), cards.map(card => card.couponCode));
  assert.equal(rows[0][7].value, "2026-11-01T12:00:00.000Z");
  assert.equal(rows[1][7].value, "");
  for (const row of rows) for (const cell of row) {
    assert.equal(typeof cell.value, "string");
    assert.equal(cell.type, String);
  }
  assert.deepEqual(shareExcelRows([], "https://example.test"), []);
  assert.equal(bulkExcelRows(cards, "https://example.test")[0].length, 9);
});
test("whole-batch sharing creates a real 10-column XLSX, preserving phone numbers, coupon codes and links as text", async () => {
  const cards = sharingCards();
  const rows = [SHARE_EXCEL_HEADERS.map(value => ({ value, type: String })), ...shareExcelRows(cards, "https://example.test")];
  const blob = await writeExcelFile(rows, { sheet: "Coupons" }).toBlob();
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(archive["xl/workbook.xml"]);
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  const strings = strFromU8(archive["xl/sharedStrings.xml"]);
  const styles = strFromU8(archive["xl/styles.xml"]);
  assert.equal((sheet.match(/<row\b/g) || []).length, 76);
  // Unformatted blanks may be omitted from XLSX; text-formatted blanks stay in place.
  assert.equal((sheet.match(/<c\b/g) || []).length, rows.reduce((count, row) => count + row.filter(cell => cell.value !== "" || cell.format).length, 0));
  assert.match(sheet, /<c\b[^>]*r="J1"/);
  assert.match(sheet, /<c\b[^>]*r="J76"/);
  for (const header of SHARE_EXCEL_HEADERS) assert.ok(strings.includes(`<t>${header}</t>`), header);
  assert.ok(strings.includes("+919876540000"));
  assert.ok(strings.includes("+919876540026"));
  assert.ok(strings.includes("0000"));
  assert.ok(strings.includes("https://example.test/card/share74"));
  assert.match(sheet, /<c\b[^>]*r="B2"[^>]*t="s"/);
  assert.match(sheet, /<c\b[^>]*r="C2"[^>]*t="s"/);
  assert.match(sheet, /<c\b[^>]*r="G76"[^>]*t="s"/);
  const textStyleIndex = Number(sheet.match(/<c\b[^>]*r="C2"[^>]*s="(\d+)"/)[1]);
  const styleXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g);
  const textFormatId = styleXfs[textStyleIndex].match(/numFmtId="(\d+)"/)[1];
  assert.ok(textFormatId === "49" || new RegExp(`<numFmt\\b[^>]*numFmtId="${textFormatId}"[^>]*formatCode="@"`).test(styles));
  for (const reference of ["B2", "C2", "G2", "B76", "C76", "G76"]) {
    assert.match(sheet, new RegExp(`<c\\b[^>]*r="${reference}"[^>]*s="${textStyleIndex}"`));
  }
});
