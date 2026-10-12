import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_COUPON_FILTERS, couponBranchKey, couponCampaignKey, couponDateBounds, filterCouponCards } from "./coupon-filters.js";

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

test("invalid custom ranges return an error and never yield exportable rows", () => {
  const reversed = { ...EMPTY_COUPON_FILTERS, dateRange: "custom", from: "2026-10-08", to: "2026-10-07" };
  assert.equal(couponDateBounds(reversed).error, "From date must be on or before To date.");
  assert.deepEqual(filterCouponCards(rows, reversed), []);
  assert.deepEqual(filter({ dateRange: "custom", from: "2026-02-30" }), []);
  assert.equal(couponDateBounds({ ...reversed, from: "not-a-date" }).error, "Choose valid dates for the custom range.");
});

test("last-seven-days calendar bounds survive month and year boundaries", () => {
  assert.deepEqual(couponDateBounds({ dateRange: "week" }, new Date(2027, 0, 2)), { from: "2026-12-27", to: "2027-01-02" });
});
