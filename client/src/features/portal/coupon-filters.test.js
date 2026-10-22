import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_COUPON_FILTERS, couponBranchKey, couponDepartmentKey, couponCampaignKey, couponStaffKey, couponDateBounds, filterCouponCards } from "./coupon-filters.js";

const rows = [
  { slug: "a", businessId: "one", branchId: "north", campaignName: "Diwali", customerPhone: "+919876543210", createdAt: new Date(2026, 9, 7, 0).toISOString() },
  { slug: "b", businessId: "one", branchId: "south", campaignName: "Diwali", customerPhone: "+919876543211", createdAt: new Date(2026, 9, 7, 23, 59, 59, 999).toISOString() },
  { slug: "c", businessId: "one", branchId: "north", campaignName: "October", customerPhone: "+447700900123", createdAt: new Date(2026, 9, 6, 12).toISOString() },
  { slug: "d", businessId: "one", branchId: "", campaignName: "", customerPhone: "+12025550123", createdAt: new Date(2026, 8, 30, 12).toISOString() },
  { slug: "e", businessId: "two", branchId: "north", campaignName: "General rewards", customerPhone: "", createdAt: "invalid" },
];
const now = new Date(2026, 9, 7, 15);
const filter = (values) => filterCouponCards(rows, { ...EMPTY_COUPON_FILTERS, ...values }, now).map(row => row.slug);

test("WhatsApp search accepts full, formatted and partial numbers and does not match missing numbers", () => {
  assert.deepEqual(filter({ number: "+91 (98765) 43210" }), ["a"]);
  assert.deepEqual(filter({ number: "900123" }), ["c"]);
  assert.deepEqual(filter({ number: "987654321" }), ["a", "b"]);
  assert.deepEqual(filter({ number: "abc" }), []);
  assert.deepEqual(filter({ number: "987abc" }), []);
});

test("coupon code search matches full or partial codes, ignores case and combines with existing filters", () => {
  const cards = [
    { ...rows[0], slug: "code-a", couponCode: "LUCKY-A1234", batchKey: "one:batch" },
    { ...rows[1], slug: "code-b", couponCode: "LUCKY-B5678" },
    { ...rows[2], slug: "code-c", couponCode: "SAVE25" },
    { ...rows[3], slug: "missing-code", offerTitle: "LUCKY-A1234" },
  ];
  const run = values => filterCouponCards(cards, { ...EMPTY_COUPON_FILTERS, ...values }, now).map(card => card.slug);
  assert.deepEqual(run({ code: " lucky-a1234 " }), ["code-a"]);
  assert.deepEqual(run({ code: "a1234" }), ["code-a"]);
  assert.deepEqual(run({ code: "LUCKY-" }), ["code-a", "code-b"]);
  assert.deepEqual(run({ code: "LUCKY-", type: "individual" }), ["code-b"]);
  assert.deepEqual(run({ code: "lucky-", type: "bulk", number: "43210", dateRange: "today",
    branch: couponBranchKey(cards[0]), campaign: couponCampaignKey("Diwali") }), ["code-a"]);
  assert.deepEqual(run({ code: "LUCKY-A1234", branch: couponBranchKey(cards[1]) }), []);
  assert.deepEqual(run({ code: "DOES-NOT-EXIST" }), []);
  assert.deepEqual(run({ code: "LUCKY-.*" }), []);
  assert.deepEqual(run({ code: "   " }), cards.map(card => card.slug));
});

test("bulk and individual views use saved batch identity, not the phone number or coupon status", () => {
  const cards = [
    { ...rows[0], slug: "bulk-with-number", batchKey: "one:batch-1", status: "redeemed" },
    { ...rows[1], slug: "bulk-without-number", batchKey: "one:batch-1", customerPhone: "" },
    { ...rows[0], slug: "individual", batchKey: "" },
    { ...rows[0], slug: "legacy-individual", customerPhone: "" },
  ];
  const run = values => filterCouponCards(cards, { ...EMPTY_COUPON_FILTERS, ...values }, now).map(card => card.slug);
  assert.deepEqual(run({}), cards.map(card => card.slug));
  assert.deepEqual(run({ type: "bulk" }), ["bulk-with-number", "bulk-without-number"]);
  assert.deepEqual(run({ type: "individual" }), ["individual", "legacy-individual"]);
  assert.deepEqual(run({ type: "bulk", number: "43210", dateRange: "today", branch: couponBranchKey(rows[0]) }), ["bulk-with-number"]);
  assert.deepEqual(run({ type: "individual", number: "43210" }), ["individual"]);
  assert.deepEqual(filterCouponCards(cards, { ...EMPTY_COUPON_FILTERS, type: "bulk" })
    .filter(card => card.status === "redeemed").map(card => card.slug), ["bulk-with-number"]);
  assert.deepEqual(run({ type: "bulk", campaign: couponCampaignKey("Missing") }), []);
});

test("branches are business-scoped and default campaigns stay distinct from named General rewards", () => {
  assert.deepEqual(filter({ branch: couponBranchKey(rows[0]) }), ["a", "c"]);
  assert.deepEqual(filter({ branch: "unassigned" }), ["d"]);
  assert.deepEqual(filter({ campaign: couponCampaignKey("") }), ["d"]);
  assert.deepEqual(filter({ campaign: couponCampaignKey("General rewards") }), ["e"]);
  assert.deepEqual(filter({ branch: couponBranchKey(rows[0]), campaign: couponCampaignKey("Diwali"), number: "43210" }), ["a"]);
});

test("date presets and custom ranges include complete local days and combine with other filters", () => {
  assert.deepEqual(filter({ dateRange: "today" }), ["a", "b"]);
  assert.deepEqual(filter({ dateRange: "week" }), ["a", "b", "c"]);
  assert.deepEqual(filter({ dateRange: "month" }), ["a", "b", "c", "d"]);
  assert.deepEqual(filter({ dateRange: "custom", from: "2026-10-07", to: "2026-10-07" }), ["a", "b"]);
  assert.deepEqual(filter({ dateRange: "custom", to: "2026-10-06" }), ["c", "d"]);
  assert.deepEqual(filter({ dateRange: "custom", from: "2026-10-07" }), ["a", "b"]);
  assert.deepEqual(filter({ dateRange: "today", branch: couponBranchKey(rows[0]), campaign: couponCampaignKey("Diwali") }), ["a"]);
  assert.deepEqual(filter({}), ["a", "b", "c", "d", "e"]);
});

test("one department selection includes matching names across branches without mixing businesses", () => {
  const cards = [
    { slug: "north-sales", businessId: "one", branchId: "north-sales", branchName: "Sales" },
    { slug: "south-sales", businessId: "one", branchId: "south-sales", branchName: " sales " },
    { slug: "service", businessId: "one", branchId: "service", branchName: "Service" },
    { slug: "foreign-sales", businessId: "two", branchId: "north-sales", branchName: "Sales" },
    { slug: "all", businessId: "one", branchId: "", branchName: "All branches" },
  ];
  const selected = couponDepartmentKey(cards[0]);
  assert.equal(selected, couponDepartmentKey(cards[1]));
  assert.notEqual(selected, couponDepartmentKey(cards[3]));
  assert.deepEqual(filterCouponCards(cards, { ...EMPTY_COUPON_FILTERS, branch: selected }).map(card => card.slug), ["north-sales", "south-sales"]);
  const currentNames = new Map([[couponBranchKey(cards[1]), "Service"]]);
  assert.deepEqual(filterCouponCards(cards, { ...EMPTY_COUPON_FILTERS, branch: selected }, now, currentNames).map(card => card.slug), ["north-sales"]);
  assert.deepEqual(filterCouponCards(cards, { ...EMPTY_COUPON_FILTERS, branch: "unassigned" }).map(card => card.slug), ["all"]);
});

test("invalid custom ranges return an error and never yield exportable rows", () => {
  const reversed = { ...EMPTY_COUPON_FILTERS, dateRange: "custom", from: "2026-10-08", to: "2026-10-07" };
  assert.equal(couponDateBounds(reversed).error, "From date must be on or before To date.");
  assert.deepEqual(filterCouponCards(rows, reversed), []);
  assert.deepEqual(filter({ dateRange: "custom", from: "2026-02-30" }), []);
  assert.equal(couponDateBounds({ ...reversed, from: "not-a-date" }).error, "Choose valid dates for the custom range.");
});

test("staff filter uses the saved redeemer identity, distinguishes namesakes and combines with other filters", () => {
  const base = { ...rows[0], branchName: "Sales", staffRedeemedAt: now.toISOString() };
  const cards = [
    { ...base, slug: "actual", staffRedeemedBy: "wrong-viewer", redemptionDetails: { staffId: "actual-staff", staffName: "Alex" } },
    { ...base, slug: "same-id", branchId: "south", redemptionDetails: { staffId: "actual-staff", staffName: "Alex renamed" } },
    { ...base, slug: "namesake", redemptionDetails: { staffId: "other-staff", staffName: "Alex" } },
    { ...base, slug: "foreign", businessId: "two", redemptionDetails: { staffId: "actual-staff", staffName: "Alex" } },
    { ...base, slug: "unredeemed", staffRedeemedAt: null, redemptionDetails: { staffId: "actual-staff", staffName: "Alex" } },
  ];
  const staff = couponStaffKey(cards[0]);
  const run = filters => filterCouponCards(cards, { ...EMPTY_COUPON_FILTERS, ...filters }, now).map(card => card.slug);
  assert.equal(staff, couponStaffKey(cards[1]));
  assert.notEqual(staff, couponStaffKey(cards[2]));
  assert.notEqual(staff, couponStaffKey(cards[3]));
  assert.equal(couponStaffKey(cards[4]), "");
  assert.deepEqual(run({ staff }), ["actual", "same-id"]);
  assert.deepEqual(run({ staff, branch: couponBranchKey(cards[0]), campaign: couponCampaignKey("Diwali"), number: "43210", dateRange: "today" }), ["actual"]);
  assert.deepEqual(run({ staff, campaign: couponCampaignKey("Other") }), []);
  assert.equal(run({}).length, cards.length);
  const legacy = { ...base, staffRedeemedByName: "Historical staff" };
  assert.ok(couponStaffKey(legacy));
  assert.deepEqual(filterCouponCards([legacy], { ...EMPTY_COUPON_FILTERS, staff: couponStaffKey(legacy) }, now), [legacy]);
});

test("last-seven-days calendar bounds survive month and year boundaries", () => {
  assert.deepEqual(couponDateBounds({ dateRange: "week" }, new Date(2027, 0, 2)), { from: "2026-12-27", to: "2027-01-02" });
});
