const tty = process.stdout.isTTY;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const green = c(32);
export const yellow = c(33);
export const red = c(31);
export const dim = c(2);
export const bold = c(1);
export const cyan = c(36);

export function outcomeColor(outcome: string): (s: string) => string {
  if (outcome === "Paid") return green;
  if (outcome === "Held") return yellow;
  return red;
}

export const log = {
  line: (s = "") => console.log(s),
  step: (s: string) => console.log(`\n${bold(s)}`),
  call: (name: string, args: unknown) => console.log(`${cyan("→ tool")} ${name} ${dim(JSON.stringify(args))}`),
  result: (s: string) => console.log(`${dim("←")} ${s}`),
  reject: (s: string) => console.log(`${red("✗ rejected locally:")} ${s}`),
};
