import { describe, expect, it } from "vitest";

import {
  authorizeProductionApply,
  productionPlanHash,
} from "../src/planning/production-apply-policy.js";
import type { ProductionPlan } from "../src/planning/production-planner.js";

const plan: ProductionPlan = {
  version: 1,
  target: "production",
  guild: { id: "123456789012345678", name: "Betrayed" },
  inventory: {
    file: "inventory.json",
    generatedAt: "2026-10-30T21:18:09.962Z",
    sha256: "a".repeat(64),
  },
  deletionAllowed: false,
  manualPrerequisites: [],
  actions: [],
  retirementCandidates: [],
  roleRetirementCandidates: [],
  requiredRoleExceptions: [],
};

describe("authorizeProductionApply", () => {
  it("requires the exact plan hash and guild", () => {
    const hash = productionPlanHash(plan);
    expect(
      authorizeProductionApply(plan, hash, plan.guild.id),
    ).toBe(hash);
    expect(() =>
      authorizeProductionApply(plan, "b".repeat(64), plan.guild.id),
    ).toThrow(/exact production plan/i);
    expect(() =>
      authorizeProductionApply(
        plan,
        hash,
        "223456789012345678",
      ),
    ).toThrow(/configured production guild/i);
  });

  it("refuses deletion actions in reconstruction", () => {
    expect(() =>
      authorizeProductionApply(
        {
          ...plan,
          actions: [
            {
              action: "delete-channel",
            } as never,
          ],
        },
        "a".repeat(64),
        plan.guild.id,
      ),
    ).toThrow(/deletion action/i);
  });
});
