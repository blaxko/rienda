import { Demo } from "../components/Demo";
import { PageCta, PageHead } from "../components/PageBits";
import { Shapes } from "../components/Shapes";
import { usePageMeta } from "../lib/meta";
import { SITE_META } from "../lib/routes";

export function Try() {
  usePageMeta(SITE_META["/try"]!.title, SITE_META["/try"]!.description, "/try");
  return (
    <>
      <PageHead title="Try to overspend" lede="You are the agent. Send a payment, then try the poisoned-page case and watch the rein freeze after three strikes." />
      <div className="panel soft demo-panel reveal">
        <Shapes className="calm" />
        <Demo />
      </div>
      <p className="demo-note reveal">This page runs the contract’s rules in your browser. Nothing is sent to a chain. The dashboard shows the real thing.</p>
      <PageCta more={{ to: "/how-it-works", label: "How it works" }}>Ready for the real one? Create a rein on testnet and point an agent at it.</PageCta>
    </>
  );
}
