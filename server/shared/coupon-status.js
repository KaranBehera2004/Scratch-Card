export const COUPON_STATUSES = ["available", "opened", "scratched", "redeemed", "expired", "disabled", "deleted"];

export function couponStatus(card, now = Date.now()) {
  // Keep the original lifecycle fields intact so restoration never resets use.
  if (card.deletedAt) return "deleted";
  // Staff redemption is final. Legacy redeemedAt values represent scratching.
  if (card.staffRedeemedAt) return "redeemed";
  if (card.disabled) return "disabled";
  if (card.expiresAt && new Date(card.expiresAt).getTime() <= Number(now)) return "expired";
  if (card.scratchedAt || card.redeemedAt) return "scratched";
  if (card.openedAt) return "opened";
  return "available";
}

export function summarizeCouponStatuses(cards, now = Date.now()) {
  const counts = Object.fromEntries(COUPON_STATUSES.map((status) => [status, 0]));
  for (const card of cards) counts[couponStatus(card, now)] += 1;
  return {
    ...counts,
    total: cards.length,
    redemptionRate: cards.length ? Math.round(counts.redeemed / cards.length * 100) : 0,
  };
}
