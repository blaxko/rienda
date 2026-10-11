import { PageCta, PageHead } from "../components/PageBits";
import { LiveFeed } from "../components/LiveFeed";
import { Shapes } from "../components/Shapes";
import { usePageMeta } from "../lib/meta";
import { SITE_META } from "../lib/routes";

export function About() {
  usePageMeta(SITE_META["/about"]!.title, SITE_META["/about"]!.description, "/about");
  return (
    <>
      <PageHead title="Your agent can spend. It can’t run off with the balance." />
      <div className="page-grid">
        <div className="prose stagger">
          <p>Rienda is a contract on Monad that sits between an AI agent and your USDC. You open a rein for each agent, set what it may do, and put money in. The agent pays through the contract. It never holds the money itself.</p>
          <p>A rein has five settings: the merchants the agent may pay, a cap per payment, a cap per day, a hard ceiling, and how many blocked attempts it gets before it is frozen.</p>
          <p>Every payment is checked in the same order. If it passes, USDC goes straight from the contract to the merchant. If it is over the cap, it waits for you to approve or deny it. If it breaks a rule, it is blocked, written onchain, and counts as a strike.</p>
          <p>After three strikes, by default, the agent is frozen. You see every attempt in the dashboard, including the ones that failed, so you know what your agent was talked into trying.</p>
          <p className="strong">Rienda does not stop an agent from being fooled. It limits what a fooled agent can do.</p>
        </div>
        <div className="panel wash visual reveal">
          <Shapes className="calm" />
          <LiveFeed />
        </div>
      </div>
      <PageCta more={{ to: "/how-it-works", label: "How it works" }}>Rienda runs on Monad Testnet today. Create a rein, connect an agent wallet and watch the first payments arrive.</PageCta>
    </>
  );
}
