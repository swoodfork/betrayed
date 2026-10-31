import { describe, expect, it } from "vitest";

import {
  authorizeTestApply,
  parseDryRunPlan,
  planHash,
} from "../src/planning/apply-policy.js";

const plan = parseDryRunPlan({
  version: 1,
  target: "test",
  guild: { id: "123456789012345678", name: "Betrayed Test" },
  deletionAllowed: false,
  actions: [
    {
      action: "create-category",
      categoryKey: "start-here",
      name: "Start Here",
    },
  ],
});

const boundaries = {
  testGuildId: "123456789012345678",
  productionGuildId: "223456789012345678",
};

describe("test apply policy", () => {
  it("binds approval to the exact plan hash", () => {
    const hash = planHash(plan);
    expect(authorizeTestApply(plan, hash, boundaries)).toBe(hash);
    expect(() => authorizeTestApply(plan, "wrong", boundaries)).toThrow(
      /does not match/i,
    );
  });

  it("refuses production even with a matching hash", () => {
    const productionPlan = parseDryRunPlan({
      ...plan,
      guild: { id: boundaries.productionGuildId, name: "Betrayed" },
    });

    expect(() =>
      authorizeTestApply(
        productionPlan,
        planHash(productionPlan),
        boundaries,
      ),
    ).toThrow(/production guild/i);
  });

  it("rejects deletion-enabled plan input", () => {
    expect(() =>
      parseDryRunPlan({ ...plan, deletionAllowed: true }),
    ).toThrow();
  });

  it("accepts a bounded category reorder action", () => {
    const reorderPlan = parseDryRunPlan({
      ...plan,
      actions: [
        {
          action: "reorder-category",
          categoryKey: "community-chat",
          categoryId: "323456789012345678",
          position: 1,
        },
      ],
    });

    expect(reorderPlan.actions[0]?.action).toBe("reorder-category");
  });

  it("accepts a hash-gated Forum channel create action", () => {
    const forumPlan = parseDryRunPlan({
      ...plan,
      actions: [
        {
          action: "create-channel",
          channelKey: "raid-applicants",
          name: "raid-applicants",
          channelType: "forum",
          targetCategoryKey: "raid-coordinator",
          targetCategoryId: "323456789012345678",
        },
      ],
    });

    expect(forumPlan.actions[0]).toMatchObject({
      action: "create-channel",
      channelType: "forum",
    });
  });

  it("accepts a bounded channel positioning action", () => {
    const positionPlan = parseDryRunPlan({
      ...plan,
      actions: [
        {
          action: "position-channel-after",
          channelKey: "raid-applicants",
          channelId: "323456789012345678",
          afterChannelKey: "coordinator-chat",
          afterChannelId: "423456789012345678",
        },
      ],
    });

    expect(positionPlan.actions[0]?.action).toBe(
      "position-channel-after",
    );
    const hash = planHash(positionPlan);
    expect(authorizeTestApply(positionPlan, hash, boundaries)).toBe(hash);
  });
});
