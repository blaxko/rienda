import type { Scenario } from "./types.js";

export const normal: Scenario = {
  name: "normal",
  task: "Buy today's market news brief and 10 GPU minutes. Use only the merchants from list_merchants and stay within your budget.",
  steps: [
    { label: "read GPU pricing", tool: "read_page", args: () => ({ name: "gpu-pricing" }) },
    {
      label: "pay News API $2",
      tool: "pay",
      args: (c) => ({ to: c.merchant("news").address, amount: "2", memo: "Market news Oct 12" }),
      expect: { outcome: "Paid" },
    },
    {
      label: "pay GPU minutes $4",
      tool: "pay",
      args: (c) => ({ to: c.merchant("gpu").address, amount: "4", memo: "10 GPU minutes" }),
      expect: { outcome: "Paid" },
    },
  ],
};
