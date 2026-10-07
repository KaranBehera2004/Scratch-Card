export const BULK_EXCEL_HEADERS = ["Branch", "Coupon Code", "Main Offer", "Offer Details", "Campaign Name", "Scratch Link", "Expiry Date", "Status", "Created At"];
export function bulkExcelRows(coupons, origin) {
  return coupons.map((card) => [card.branchName, card.couponCode, card.offerTitle,
    card.description, card.campaignName, `${origin}/card/${card.slug}`,
    card.expiresAt ? new Date(card.expiresAt).toISOString() : "", card.status,
    card.createdAt ? new Date(card.createdAt).toISOString() : "",
  ].map((value) => ({ value: String(value ?? ""), type: String })));
}
export const SHARE_EXCEL_HEADERS = ["Branch", "Coupon Code", "WhatsApp Number", "Main Offer", "Offer Details", "Campaign Name", "Scratch Link", "Expiry Date", "Status", "Created At"];
export function shareExcelRows(coupons, origin) {
  return bulkExcelRows(coupons, origin).map((row, index) => [
    row[0],
    { ...row[1], format: "@" },
    { value: String(coupons[index].customerPhone ?? ""), type: String, format: "@" },
    ...row.slice(2, 5),
    { ...row[5], format: "@" },
    ...row.slice(6),
  ]);
}
export function unusedBulkBranches(rows, active) {
  const selected = new Set(rows.map((row) => row.branchId));
  return active.filter((branch) => !selected.has(branch.branchId));
}
export function addBulkBranch(rows, branchId) {
  if (!branchId || rows.some((row) => row.branchId === branchId)) return rows;
  const empty = rows.findIndex((row) => !row.branchId);
  return empty >= 0 ? rows.map((row, index) => index === empty ? { ...row, branchId } : row)
    : [...rows, { branchId, quantity: 25 }];
}
export function mergeBulkResults(batches) {
  const ids = new Set(), coupons = new Map();
  for (const batch of batches.filter(Boolean)) {
    for (const id of batch.batchIds || [batch.batchId]) if (id) ids.add(id);
    for (const card of batch.coupons || []) coupons.set(card.slug, card);
  }
  const batchIds = [...ids];
  return { batchId: batchIds[0], batchIds, savedCount: coupons.size, coupons: [...coupons.values()],
    replayed: batches.some((batch) => batch?.replayed) };
}
export function generatedByBranch(coupons = []) {
  const counts = new Map();
  for (const card of new Map(coupons.map((card) => [card.slug, card])).values())
    counts.set(card.branchId, (counts.get(card.branchId) || 0) + 1);
  return counts;
}
export function remainingBranchQuantities(rows, coupons = []) {
  const counts = generatedByBranch(coupons);
  return rows.map((row) => ({ branchId: row.branchId,
    quantity: Math.max(0, Number(row.quantity) - (counts.get(row.branchId) || 0)) }))
    .filter((row) => Number.isSafeInteger(row.quantity) && row.quantity > 0);
}
export function branchQuantityError(rows, coupons = []) {
  if (!rows.length) return "Add at least one branch.";
  const selected = new Set();
  let total = 0;
  const generated = generatedByBranch(coupons);
  for (const row of rows) {
    if (!row.branchId) return "Choose a branch for every row.";
    if (selected.has(row.branchId)) return "Each branch can be selected only once.";
    selected.add(row.branchId);
    if (!/^\d+$/.test(String(row.quantity)) || !Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) < 1)
      return "Coupon quantities must be positive whole numbers.";
    if (Number(row.quantity) < (generated.get(row.branchId) || 0))
      return "Quantity cannot be lower than coupons already generated for that branch.";
  }
  total = remainingBranchQuantities(rows, coupons).reduce((sum, row) => sum + row.quantity, 0);
  return total > 1000 ? "Generate at most 1000 coupons per batch." : "";
}
