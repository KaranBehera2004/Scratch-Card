import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCampaigns } from "./campaigns.js";

test("campaign totals count each card once and separate businesses and branches", () => {
  const cards = [
    { businessId: "a", campaignName: "Diwali", branchId: "one", branchName: "Old name", used: true },
    { businessId: "a", campaignName: "Diwali", branchId: "one", used: false },
    { businessId: "a", campaignName: "Diwali", branchId: "two", branchName: "Secunderabad", used: false },
    { businessId: "a", campaignName: "Diwali", used: false },
    { businessId: "b", campaignName: "Diwali", branchId: "one", branchName: "Vijayawada", used: true },
    { businessId: "a", campaignName: "", used: false },
  ];
  const groups = summarizeCampaigns(cards, [{ businessId: "a", name: "Alpha", branches: [{ branchId: "one", name: "Hyderabad" }] }]);
  assert.equal(groups.length, 3);
  const diwali = groups.find((group) => group.businessId === "a" && group.name === "Diwali");
  assert.equal(diwali.total, 4);
  assert.equal(diwali.used, 1);
  assert.deepEqual(diwali.branches, [
    { branchId: "one", branchName: "Hyderabad", total: 2, used: 1 },
    { branchId: "two", branchName: "Secunderabad", total: 1, used: 0 },
    { branchId: "", branchName: "All branches", total: 1, used: 0 },
  ]);
  for (const group of groups) assert.equal(group.branches.reduce((total, branch) => total + branch.total, 0), group.total);
  assert.equal(groups.reduce((total, group) => total + group.total, 0), cards.length);
  assert.equal(groups.find((group) => group.businessId === "b").branches[0].branchName, "Vijayawada");
  assert.equal(groups.find((group) => group.defaultName).name, "General rewards");
});

test("empty and named General rewards campaigns remain distinct", () => {
  assert.deepEqual(summarizeCampaigns([], []), []);
  const groups = summarizeCampaigns([
    { businessId: "a", campaignName: "", used: false },
    { businessId: "a", campaignName: "General rewards", used: false },
  ], []);
  assert.equal(groups.length, 2);
  assert.equal(new Set(groups.map((group) => group.key)).size, 2);
});
