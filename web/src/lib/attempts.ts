export type Attempt = { who: string; amount: string; outcome: "Paid" | "Held" | "Blocked"; why: string };

// Illustrative activity for the landing and about pages. The demo runs the same rules; the dashboard shows the real thing.
export const ATTEMPTS: Attempt[] = [
  { who: "News API", amount: "$2.00", outcome: "Paid", why: "Within every limit" },
  { who: "GPU minutes", amount: "$4.00", outcome: "Paid", why: "Within every limit" },
  { who: "GPU minutes", amount: "$12.00", outcome: "Held", why: "Above the per-payment cap. Waiting for the owner" },
  { who: "Unknown address", amount: "$500.00", outcome: "Blocked", why: "Recipient is not on the allowed list" },
  { who: "Coffee", amount: "$3.50", outcome: "Paid", why: "Within every limit" },
  { who: "Unknown address", amount: "$75.00", outcome: "Blocked", why: "Recipient is not on the allowed list" },
  { who: "News API", amount: "$60.00", outcome: "Blocked", why: "Above the hold ceiling" },
  { who: "GPU minutes", amount: "$4.00", outcome: "Paid", why: "Within every limit" },
];

export const pillClass = (o: Attempt["outcome"]) => (o === "Paid" ? "pill paid" : o === "Held" ? "pill amber" : "pill red");
