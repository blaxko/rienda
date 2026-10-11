import { CheckCircle, XCircle } from "@untitledui/icons";
import { Link } from "../router";
import { RIENDA, addressUrl } from "../config";
import { shortAddr } from "../lib/format";
import { Words } from "../lib/motion";
import { ATTEMPTS, pillClass } from "../lib/attempts";
import { usePageMeta } from "../lib/meta";
import { SITE_META } from "../lib/routes";
import { LiveFeed } from "../components/LiveFeed";
import { ReadMore, ReinDivider } from "../components/PageBits";
import { ReinLine } from "../components/ReinLine";
import { Shapes } from "../components/Shapes";
import { Steps } from "../components/Steps";

const REPO = "https://github.com/blaxko/rienda";

export function Landing() {
  usePageMeta(SITE_META["/"]!.title, SITE_META["/"]!.description, "/");
  const loop = [...ATTEMPTS, ...ATTEMPTS];

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <Shapes />
        <ReinLine className="hero-line" onLoad draw={false} />
        <div className="hero-inner">
          <div className="hero-copy">
            <h1 id="hero-title"><Words text="Give your AI agent a spending limit it can’t talk its way past." /></h1>
            <p className="lede reveal">Rienda is a contract on Monad. You choose who your agent can pay and how much. Small payments go through, big ones wait for you, and everything else is blocked and written onchain.</p>
            <div className="cta-row reveal">
              <Link to="/app" className="btn large">Open app</Link>
              <Link to="/how-it-works" className="link-arrow">How it works</Link>
            </div>
          </div>
          <div className="hero-float" aria-hidden="true">
            <span className="hero-float-label">Example payments</span>
            <div className="float-card glass refract">
              <span className="pill paid"><CheckCircle width={14} height={14} />Paid</span>
              <div><div className="fc-amt">$2.00</div><div className="fc-sub">News API · within every limit</div></div>
            </div>
            <div className="float-card glass refract">
              <span className="pill red"><XCircle width={14} height={14} />Blocked</span>
              <div><div className="fc-amt">$500.00</div><div className="fc-sub">Unknown address · strike 1 of 3</div></div>
            </div>
          </div>
        </div>
      </section>

      <div className="ticker-band reveal">
        <div className="ticker-label">Example agent activity</div>
        <div className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {loop.map((a, i) => (
              <div className="chip" key={i}>
                <span className={pillClass(a.outcome)}>{a.outcome}</span>
                <span className="amt">{a.amount}</span>
                <span className="muted">{a.who}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="section" aria-labelledby="what-title">
        <h2 id="what-title" className="reveal">Your agent can spend. It can’t run off with the balance.</h2>
        <p className="sub reveal">Rienda sits between your agent and your USDC. Every payment is checked against limits you set before any money moves.</p>
        <dl className="defs stagger">
          <div><dt>One shared contract</dt><dd>You put USDC in a rein. Your agent is a plain wallet that holds only MON for gas, so it never holds your money.</dd></div>
          <div><dt>Limits you set</dt><dd>Pick the merchants, a cap per payment, a cap per day, and a hard ceiling. Anything over the cap waits for your yes or no.</dd></div>
          <div><dt>A record of every attempt</dt><dd>Blocked payments are written onchain too. After enough of them the contract freezes the agent, and you see what it tried.</dd></div>
        </dl>
        <ReadMore to="/about">What Rienda is</ReadMore>
      </section>

      <div className="section-rule"><ReinDivider /></div>

      <section className="section tight" aria-labelledby="rein-title">
        <div className="duo">
          <div className="panel soft reveal">
            <div>
              <h2 id="rein-title">A rein doesn’t stop the horse. It decides where it can go.</h2>
              <p className="sub">A prompt-injected agent may try to pay a stranger. The contract says no, records the try, and counts a strike.</p>
            </div>
            <dl className="rows">
              <div><dt>Recipients</dt><dd>Only the merchants you list</dd></div>
              <div><dt>Each payment</dt><dd>Up to your cap, or it waits for you</dd></div>
              <div><dt>Each day</dt><dd>Up to your daily cap</dd></div>
              <div><dt>Too many strikes</dt><dd>The agent is frozen</dd></div>
            </dl>
            <ReadMore to="/about">How a rein works</ReadMore>
          </div>
          <div className="panel wash reveal">
            <Shapes className="calm" />
            <LiveFeed />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="how-title">
        <h2 id="how-title" className="reveal">How it works</h2>
        <Steps />
        <ReadMore to="/how-it-works">The six checks, in order</ReadMore>
      </section>

      <section className="section" aria-labelledby="try-title">
        <div className="panel soft try-teaser reveal">
          <Shapes className="calm" />
          <div>
            <h2 id="try-title">Try to overspend</h2>
            <p className="sub">Play the agent. Send a payment and see whether it is paid, held for you or blocked. Then try the poisoned-page case.</p>
            <div className="cta-row"><Link to="/try" className="btn large">Try the demo</Link></div>
          </div>
          <div className="outcome-trio" aria-hidden="true">
            <div className="glass"><span className="pill paid">Paid</span><b>$2.00</b><small>News API</small></div>
            <div className="glass"><span className="pill amber">Held</span><b>$12.00</b><small>GPU minutes</small></div>
            <div className="glass"><span className="pill red">Blocked</span><b>$500.00</b><small>Unknown address</small></div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="dev-title">
        <div className="duo">
          <div className="reveal">
            <h2 id="dev-title">For agent builders</h2>
            <p className="sub">One call. The SDK simulates it, sends it and tells you whether it was paid, held or blocked.</p>
            <ReadMore to="/developers">The developer guide</ReadMore>
          </div>
          <div className="code mini reveal" role="region" aria-label="SDK call" tabIndex={0}>
            <pre>{`const r = await rienda.pay({
  reinId: 2n, to: "0xMerchant…",
  amount: parseUnits("2", 6), memo: "News brief",
});
`}<span className="c">{`// r.outcome: "Paid" | "Held" | "Blocked"`}</span>{`
`}</pre>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="trust-title">
        <div className="duo">
          <div className="reveal">
            <h2 id="trust-title">Where the money is, and who can move it</h2>
            <p className="sub">USDC stays in the contract. The agent can’t withdraw it and can’t send it to an address you didn’t list. Only you can deposit, withdraw, approve or unfreeze.</p>
            <ReadMore to="/security">How the money is protected</ReadMore>
          </div>
          <div className="trust-links reveal">
            {RIENDA && <a href={addressUrl(RIENDA)} target="_blank" rel="noreferrer"><span>Contract on the explorer</span><span className="mono">{shortAddr(RIENDA)}</span></a>}
            <a href={`${REPO}/blob/main/contracts/src/Rienda.sol`} target="_blank" rel="noreferrer"><span>Contract source</span><span className="mono">Rienda.sol</span></a>
            <a href={`${REPO}/blob/main/docs/threat-model.md`} target="_blank" rel="noreferrer"><span>Threat model</span><span className="mono">docs/threat-model.md</span></a>
          </div>
        </div>
      </section>
    </>
  );
}
