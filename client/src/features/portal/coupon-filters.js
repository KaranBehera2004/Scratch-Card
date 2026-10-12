export const EMPTY_COUPON_FILTERS = {
  number: "", branch: "", campaign: "", dateRange: "all", from: "", to: "",
};

export const couponBranchKey = (card) => JSON.stringify([card.businessId, card.branchId]);
export const couponCampaignKey = (name) => JSON.stringify(name ? ["named", name] : ["default"]);

function localDateKey(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && localDateKey(date) === value;
}

export function couponDateBounds(filters, now = new Date()) {
  if (filters.dateRange === "custom") {
    const { from, to } = filters;
    if ((from && !validDateKey(from)) || (to && !validDateKey(to)))
      return { error: "Choose valid dates for the custom range." };
    if (from && to && from > to)
      return { error: "From date must be on or before To date." };
    return { from, to };
  }
  const days = { today: 1, week: 7, month: 30 }[filters.dateRange];
  if (!days) return {};
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  return { from: localDateKey(start), to: localDateKey(now) };
}

export function filterCouponCards(cards, filters, now = new Date()) {
  const bounds = couponDateBounds(filters, now);
  if (bounds.error) return [];
  const rawNumber = filters.number.trim();
  const digits = rawNumber.replace(/\D/g, "");
  return cards.filter((card) => {
    if (rawNumber && (!digits || !/^[+0-9 ()-]+$/.test(rawNumber)
      || !String(card.customerPhone || "").replace(/\D/g, "").includes(digits))) return false;
    if (filters.branch === "unassigned" && card.branchId) return false;
    if (filters.branch && filters.branch !== "unassigned" && couponBranchKey(card) !== filters.branch) return false;
    if (filters.campaign && couponCampaignKey(card.campaignName) !== filters.campaign) return false;
    if (bounds.from || bounds.to) {
      const created = new Date(card.createdAt);
      if (!card.createdAt || !Number.isFinite(created.getTime())) return false;
      // Compare local calendar dates, not UTC midnight or a truncated end-of-day timestamp.
      const date = localDateKey(created);
      if ((bounds.from && date < bounds.from) || (bounds.to && date > bounds.to)) return false;
    }
    return true;
  });
}
