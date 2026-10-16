import test from "node:test";
import assert from "node:assert/strict";
import { COUPON_STATUSES, couponStatus, summarizeCouponStatuses } from "./coupon-status.js";

const now = new Date("2026-10-16T08:00:00.000Z");
const past = "2026-10-15T08:00:00.000Z";
const future = "2026-10-17T08:00:00.000Z";

test("opening and scratching do not count as staff redemption, including legacy cards", () => {
  assert.equal(couponStatus({}, now), "available");
  assert.equal(couponStatus({ openedAt: past }, now), "opened");
  assert.equal(couponStatus({ openedAt: past, scratchedAt: past }, now), "scratched");
  assert.equal(couponStatus({ redeemedAt: past, used: true }, now), "scratched");
  assert.equal(couponStatus({ scratchedAt: past, staffRedeemedAt: past }, now), "redeemed");
});

test("expired and disabled unredeemed cards leave the opened or scratched buckets", () => {
  for (const progress of [{}, { openedAt: past }, { scratchedAt: past }, { redeemedAt: past }]) {
    assert.equal(couponStatus({ ...progress, expiresAt: future }, now), couponStatus(progress, now));
    assert.equal(couponStatus({ ...progress, expiresAt: past, status: "scratched" }, now), "expired");
    assert.equal(couponStatus({ ...progress, disabled: true }, now), "disabled");
  }
  assert.equal(couponStatus({ expiresAt: now.toISOString(), scratchedAt: past }, now), "expired");
  assert.equal(couponStatus({ expiresAt: past, disabled: true, scratchedAt: past }, now), "disabled");
  assert.equal(couponStatus({ expiresAt: past, disabled: true, staffRedeemedAt: past }, now), "redeemed");
});

test("all six exclusive status counts reconcile to 94 and 15 staff redemptions round to 16 percent", () => {
  const cards = [
    ...Array.from({ length: 44 }, () => ({})),
    ...Array.from({ length: 10 }, () => ({ openedAt: past })),
    ...Array.from({ length: 12 }, () => ({ scratchedAt: past })),
    ...Array.from({ length: 15 }, () => ({ staffRedeemedAt: past, expiresAt: past })),
    ...Array.from({ length: 8 }, () => ({ scratchedAt: past, expiresAt: past })),
    ...Array.from({ length: 5 }, () => ({ scratchedAt: past, disabled: true })),
  ];
  const before = JSON.stringify(cards);
  const counts = summarizeCouponStatuses(cards, now);
  assert.deepEqual(counts, {
    available: 44, opened: 10, scratched: 12, redeemed: 15, expired: 8, disabled: 5, total: 94, redemptionRate: 16,
  });
  assert.equal(COUPON_STATUSES.reduce((total, status) => total + counts[status], 0), counts.total);
  assert.equal(JSON.stringify(cards), before);
});

test("an empty dashboard has zero counts and a finite zero redemption rate", () => {
  const counts = summarizeCouponStatuses([], now);
  assert.equal(counts.total, 0);
  assert.equal(counts.redemptionRate, 0);
  assert.ok(COUPON_STATUSES.every((status) => counts[status] === 0));
});
