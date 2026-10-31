import { describe, expect, it } from "vitest";

import {
  authorizeTestCleanup,
  cleanupPlanHash,
  cleanupPlanSchema,
} from "../src/planning/cleanup-policy.js";

const plan = cleanupPlanSchema.parse({
  version: 1,
  target: "test",
  purpose: "remove-generated-resources",
  guild: { id: "123456789012345678", name: "Betrayed Test" },
  sourceApplyPlanHash:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  actions: [
    {
      action: "delete-channel",
      resourceId: "323456789012345678",
      expectedName: "generated-channel",
    },
  ],
});
const boundaries = {
  testGuildId: "123456789012345678",
  productionGuildId: "223456789012345678",
};

describe("test cleanup policy", () => {
  it("requires the exact cleanup plan hash", () => {
    const hash = cleanupPlanHash(plan);
    expect(authorizeTestCleanup(plan, hash, boundaries)).toBe(hash);
    expect(() => authorizeTestCleanup(plan, "wrong", boundaries)).toThrow(
      /does not match/i,
    );
  });

  it("refuses cleanup in production", () => {
    const productionPlan = cleanupPlanSchema.parse({
      ...plan,
      guild: { id: boundaries.productionGuildId, name: "Betrayed" },
    });
    expect(() =>
      authorizeTestCleanup(
        productionPlan,
        cleanupPlanHash(productionPlan),
        boundaries,
      ),
    ).toThrow(/production guild/i);
  });

  it("requires an owner reason for retiring pre-existing test resources", () => {
    expect(() =>
      cleanupPlanSchema.parse({
        ...plan,
        purpose: "owner-approved-test-retirement",
        sourceApplyPlanHash: undefined,
      }),
    ).toThrow(/requires a reason/i);
  });
});
