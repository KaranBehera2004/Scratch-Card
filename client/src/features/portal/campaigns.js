// Group campaigns per business, then count every card once in its assigned branch.
// Blank branch IDs are an "All branches" bucket, not cards to duplicate per branch.
export function summarizeCampaigns(cards, businesses) {
  const groups = new Map();
  for (const card of cards) {
    const key = JSON.stringify([card.businessId, card.campaignName || null]);
    if (!groups.has(key)) groups.set(key, {
      key,
      name: card.campaignName || "General rewards",
      defaultName: !card.campaignName,
      businessId: card.businessId,
      businessName: businesses.find((business) => business.businessId === card.businessId)?.name || card.senderName,
      total: 0,
      used: 0,
      branches: new Map(),
    });
    const group = groups.get(key);
    const branchId = card.branchId || "";
    if (!group.branches.has(branchId)) group.branches.set(branchId, {
      branchId,
      branchName: businesses.find((business) => business.businessId === card.businessId)
        ?.branches?.find((branch) => branch.branchId === branchId)?.name
        || card.branchName || "All branches",
      total: 0,
      used: 0,
    });
    const branch = group.branches.get(branchId);
    group.total++;
    group.used += card.used ? 1 : 0;
    branch.total++;
    branch.used += card.used ? 1 : 0;
  }
  return [...groups.values()].map((group) => ({
    ...group,
    branches: [...group.branches.values()],
  }));
}
