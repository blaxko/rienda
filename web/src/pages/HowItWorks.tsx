import { PageCta, PageHead } from "../components/PageBits";
import { Steps } from "../components/Steps";
import { usePageMeta } from "../lib/meta";
import { SITE_META } from "../lib/routes";

const CHECKS = [
  ["Is the recipient on your list?", "If not: blocked, one strike."],
  ["Is the amount under your hard ceiling?", "If not: blocked, one strike."],
  ["Are fewer than five payments already waiting?", "If not: blocked, one strike."],
  ["Is it under the per-payment and daily caps?", "If not: held until you approve or deny it."],
  ["Is there enough balance?", "If not: blocked, no strike."],
  ["Otherwise", "Paid. USDC goes from the contract to the merchant."],
] as const;

export function HowItWorks() {
  usePageMeta(SITE_META["/how-it-works"]!.title, SITE_META["/how-it-works"]!.description, "/how-it-works");
  return (
    <>
      <PageHead title="Three steps, then you only step in when it matters." />
      <Steps />
      <section className="split-block">
        <div className="prose reveal">
          <h2>What the contract checks</h2>
          <p>Each payment goes through the same six checks, in this order. A rule is never skipped, and the call never reverts for one. That is why a blocked attempt is recorded and can freeze the agent.</p>
        </div>
        <ol className="checks stagger">
          {CHECKS.map(([q, a], i) => (
            <li key={q}><span className="check-n">{i + 1}</span><span><strong>{q}</strong><br /><span className="muted">{a}</span></span></li>
          ))}
        </ol>
      </section>
      <PageCta to="/try" label="Try it" more={{ to: "/developers", label: "For developers" }} />
    </>
  );
}
