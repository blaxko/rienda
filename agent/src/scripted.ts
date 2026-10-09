import { executeTool, type Tool } from "./tools.js";
import type { Expect, Scenario, StepContext } from "../scenarios/types.js";
import { bold, dim, green, log, outcomeColor, red } from "./log.js";

export type Row = {
  step: number;
  label: string;
  actual: string;
  tx?: string;
  ok: boolean;
  outcome?: string;
  reverted?: boolean;
  frozen?: boolean;
};

function matches(expect: Expect | undefined, result: any): boolean {
  if (!expect) return result?.ok !== false;
  if (expect.revert) return result?.reverted === true && result.error === expect.revert;
  if (result?.ok !== true) return false;
  if (expect.outcome && result.outcome !== expect.outcome) return false;
  if (expect.reason && result.reason !== expect.reason) return false;
  if (expect.frozen && !result.frozen) return false;
  return true;
}

function describe(result: any): string {
  if (result?.outcome) {
    return [result.outcome, result.reason, result.frozen ? "FROZEN" : undefined].filter(Boolean).join(" · ");
  }
  if (result?.reverted) return `REVERT ${result.error}`;
  if (result?.ok === false) return `error: ${result.error}`;
  return "ok";
}

/** Replays a fixed tool-call list through the same tools (real transactions, strictly one at a time). */
export async function runScripted(scenario: Scenario, tools: Tool<any>[], stepCtx: StepContext): Promise<Row[]> {
  const rows: Row[] = [];
  log.line(bold(`Scripted mode · scenario "${scenario.name}" (agent actions are scripted; every transaction is real)`));

  for (const [i, step] of scenario.steps.entries()) {
    log.step(`Step ${i + 1}/${scenario.steps.length}: ${step.label}`);
    // each pay() awaits its receipt before returning, so the next step never races the nonce
    const result = await executeTool(tools, step.tool, step.args(stepCtx));
    const ok = matches(step.expect, result);
    if (!ok) log.line(red(`   ✗ unexpected result (expected ${JSON.stringify(step.expect)})`));
    rows.push({
      step: i + 1,
      label: step.label,
      actual: describe(result),
      tx: result?.explorer,
      ok,
      outcome: result?.outcome,
      reverted: result?.reverted,
      frozen: result?.frozen,
    });
  }
  return rows;
}

export function printSummary(rows: Row[]): void {
  log.line(`\n${bold("Summary")}`);
  const w = Math.max(...rows.map((r) => r.label.length));
  for (const r of rows) {
    const color = r.ok ? (r.outcome ? outcomeColor(r.outcome) : r.reverted ? red : dim) : red;
    log.line(
      `${String(r.step).padStart(2)}  ${r.label.padEnd(w)}  ${color(r.actual.padEnd(28))} ${r.ok ? green("✓") : red("✗")}  ${r.tx ?? ""}`,
    );
  }
  const count = (o: string) => rows.filter((r) => r.outcome === o).length;
  const frozen = rows.some((r) => r.frozen);
  const reverts = rows.filter((r) => r.reverted).length;
  log.line(
    `\n${count("Paid")} Paid, ${count("Held")} Held, ${count("Blocked")} Blocked${frozen ? ", Frozen" : ""}${reverts ? `, then ${reverts} revert` : ""}`,
  );
  const bad = rows.filter((r) => !r.ok).length;
  log.line(bad ? red(`${bad} step(s) did not match expectations`) : green("All steps matched expectations"));
}
