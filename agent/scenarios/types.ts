import type { Merchant } from "../src/tools.js";

export type Expect = {
  /** pay outcome expected */
  outcome?: "Paid" | "Held" | "Blocked";
  reason?: string;
  /** pay should revert with this Solidity error name */
  revert?: string;
  /** the transaction should also freeze the rein */
  frozen?: boolean;
};

export type StepContext = { merchant: (key: string) => Merchant; attacker: `0x${string}` };

export type ScriptedStep = {
  label: string;
  tool: "read_page" | "pay";
  args: (c: StepContext) => Record<string, unknown>;
  expect?: Expect;
};

export type Scenario = {
  name: "normal" | "injection";
  steps: ScriptedStep[];
};
