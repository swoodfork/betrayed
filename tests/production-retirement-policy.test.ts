import { describe, expect, it } from "vitest";

import {
  authorizeProductionRetirement,
  productionRetirementPlanHash,
  type ProductionRetirementPlan,
} from "../src/planning/production-retirement-policy.js";

const plan: ProductionRetirementPlan = {
  version: 1,
  target: "production",
  purpose: "converge-production-to-approved-test-design",
  guild: { id: "123456789012345678", name: "Betrayed" },
  sourceInventory: {
    file: "inventory.json",
    generatedAt: "2026-10-30T21:27:15.209Z",
    sha256: "a".repeat(64),
  },
  sourcePlanHash: "b".repeat(64),
  deletionAllowed: true,
  applyAfterReconstruction: true,
  actions: [
    {
      action: "delete-channel",
      resourceId: "223456789012345678",
      expectedName: "legacy",
    },
  ],
  requiredRoleExceptions: [],
};

describe("authorizeProductionRetirement", () => {
  it("binds approval to the exact retirement and source plans", () => {
    const hash = productionRetirementPlanHash(plan);
    expect(
      authorizeProductionRetirement(
        plan,
        hash,
        plan.guild.id,
        plan.sourcePlanHash,
      ),
    ).toBe(hash);
    expect(() =>
      authorizeProductionRetirement(
        plan,
        hash,
        plan.guild.id,
        "c".repeat(64),
      ),
    ).toThrow(/converged reconstruction/i);
    expect(() =>
      authorizeProductionRetirement(
        plan,
        "d".repeat(64),
        plan.guild.id,
        plan.sourcePlanHash,
      ),
    ).toThrow(/exact retirement plan/i);
  });
});
