/** Title and description for every marketing page. Used by the pages (tab title) and the build (one HTML file per route). */
export const SITE_META: Record<string, { title: string; description: string }> = {
  "/": { title: "Rienda: spending limits for AI agents", description: "Rienda is a contract on Monad that limits what your AI agent can pay. Small payments go through, big ones wait for you, and the rest are blocked and recorded onchain." },
  "/about": { title: "What Rienda is · Rienda", description: "Rienda is a contract on Monad that sits between an AI agent and your USDC. You set the merchants and limits; every payment is checked before money moves." },
  "/how-it-works": { title: "How it works · Rienda", description: "Create a rein, let your agent pay through the contract, and step in only when a payment is held or blocked. The six checks run in the same order every time." },
  "/try": { title: "Try it · Rienda", description: "Send payments as an agent and watch a rein handle them: paid, held for approval, blocked, then frozen after three strikes. A simulation of the contract's rules." },
  "/developers": { title: "Developers · Rienda", description: "Pay through a rein from your agent with the Rienda SDK: simulate, send with a fixed gas limit, and read the outcome (Paid, Held or Blocked) from the receipt." },
  "/security": { title: "Trust · Rienda", description: "USDC stays in the Rienda contract. The agent holds only gas, limits are enforced onchain, and the contract is verified. Read what Rienda does and does not protect." },
};
