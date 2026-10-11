import { useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle, FileCheck02, Lock01, Sliders01, XCircle, XClose } from "@untitledui/icons";
import { Link } from "../router";
import { RIENDA, addressUrl, chain } from "../config";
import { shortAddr } from "../lib/format";
import { CountUp, Words, reducedMotion, useRevealOnScroll } from "../lib/motion";
import { Demo } from "../components/Demo";
import { Shapes } from "../components/Shapes";

const REPO = "https://github.com/blaxko/rienda";

type Attempt = { who: string; amount: string; outcome: "Paid" | "Held" | "Blocked"; why: string };

// Illustrative activity. The demo below runs the same rules; the dashboard shows the real thing.
const ATTEMPTS: Attempt[] = [
  { who: "News API", amount: "$2.00", outcome: "Paid", why: "Within every limit" },
  { who: "GPU minutes", amount: "$4.00", outcome: "Paid", why: "Within every limit" },
  { who: "GPU minutes", amount: "$12.00", outcome: "Held", why: "Above the per-payment cap. Waiting for the owner" },
  { who: "Unknown address", amount: "$500.00", outcome: "Blocked", why: "Recipient is not on the allowed list" },
  { who: "Coffee", amount: "$3.50", outcome: "Paid", why: "Within every limit" },
  { who: "Unknown address", amount: "$75.00", outcome: "Blocked", why: "Recipient is not on the allowed list" },
  { who: "News API", amount: "$60.00", outcome: "Blocked", why: "Above the hold ceiling" },
  { who: "GPU minutes", amount: "$4.00", outcome: "Paid", why: "Within every limit" },
];

const pillClass = (o: Attempt["outcome"]) => (o === "Paid" ? "pill" : o === "Held" ? "pill amber" : "pill red");

function LiveFeed() {
  const [n, setN] = useState(4);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => setN((x) => x + 1), 2800);
    return () => clearInterval(t);
  }, []);
  const rows = Array.from({ length: 5 }, (_, i) => ({ k: n - i, a: ATTEMPTS[(n - i) % ATTEMPTS.length]! }));
  return (
    <div className="feed-card">
      <div className="head"><span className="live-dot">Agent activity</span><span>Example data</span></div>
      <ul className="attempts" aria-label="Example agent payment attempts">
        {rows.map(({ k, a }) => (
          <li key={k} className={a.outcome}>
            <span className={`${pillClass(a.outcome)} out`}>
              {a.outcome === "Blocked" ? <XCircle width={14} height={14} aria-hidden /> : <CheckCircle width={14} height={14} aria-hidden />}
              {a.outcome}
            </span>
            <span><span className="who">{a.who}</span><div className="why">{a.why}</div></span>
            <span className="amt">{a.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Landing() {
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [bar, setBar] = useState(true);
  const loop = [...ATTEMPTS, ...ATTEMPTS];
  const close = () => setMenu(false);
  useRevealOnScroll();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <>
      {bar && (
        <div className="announce">
          <span className="live-dot-light" aria-hidden />
          <strong>Live on {chain.name}.</strong>
          <span className="hide-sm"> Every payment your agent makes is checked against your limits.</span>
          {RIENDA && <a href={addressUrl(RIENDA)} target="_blank" rel="noreferrer" className="announce-link">See the contract</a>}
          <button className="announce-x" onClick={() => setBar(false)} aria-label="Dismiss announcement"><XClose width={16} height={16} aria-hidden /></button>
        </div>
      )}

      <div className={`nav-wrap ${scrolled || menu ? "scrolled" : ""}`}>
        <div className="wrap">
          <header className="nav">
            <Link to="/" className="wordmark"><span className="mark" aria-hidden />Rienda</Link>
            <nav className={`nav-links ${menu ? "open" : ""}`} id="nav-links" aria-label="Main">
              <a href="#what" onClick={close}>What it is</a>
              <a href="#how" onClick={close}>How it works</a>
              <a href="#demo" onClick={close}>Try it</a>
              <a href="#developers" onClick={close}>Developers</a>
              <a href="#trust" onClick={close}>Trust</a>
            </nav>
            <div className="nav-end">
              <a className="btn small hide-sm" href={`${REPO}#readme`} target="_blank" rel="noreferrer">Read the docs</a>
              <Link to="/app" className="btn small secondary">Open app <ArrowUpRight width={14} height={14} aria-hidden /></Link>
              <button className="nav-menu" aria-expanded={menu} aria-controls="nav-links" aria-label={menu ? "Close menu" : "Open menu"} onClick={() => setMenu((m) => !m)}>
                {menu ? <XClose width={22} height={22} aria-hidden /> : <span className="burger" aria-hidden />}
              </button>
            </div>
          </header>
        </div>
      </div>

      <div className="wrap">
        <main>
          <section className="hero" aria-labelledby="hero-title">
            <Shapes />
            <div className="hero-copy">
              <h1 id="hero-title"><Words text="Give your AI agent a spending limit it can’t talk its way past." /></h1>
              <p className="lede reveal">Rienda is a contract on Monad. You choose who your agent can pay and how much. Small payments go through, big ones wait for you, and everything else is blocked and written onchain.</p>
              <div className="cta-row reveal">
                <Link to="/app" className="btn large">Open app</Link>
                <a href="#how" className="link-arrow">How it works</a>
              </div>
            </div>
            <div className="hero-float" aria-hidden="true">
              <div className="float-card glass refract f1">
                <span className="pill"><CheckCircle width={14} height={14} />Paid</span>
                <div><div className="fc-amt">$2.00</div><div className="fc-sub">News API · within every limit</div></div>
              </div>
              <div className="float-card glass refract f2">
                <span className="pill red"><XCircle width={14} height={14} />Blocked</span>
                <div><div className="fc-amt">$500.00</div><div className="fc-sub">Unknown address · strike 1 of 3</div></div>
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

          <section className="section" id="what" aria-labelledby="what-title">
            <h2 id="what-title" className="reveal">Your agent can spend. It can’t run off with the balance.</h2>
            <p className="sub reveal">Rienda sits between your agent and your USDC. Every payment is checked against limits you set before any money moves.</p>
            <div className="tiles stagger">
              <div className="tile"><Lock01 width={22} height={22} aria-hidden /><div><h3>One shared contract</h3><p>You put USDC in a rein. Your agent is a plain wallet that holds only MON for gas, so it never holds your money.</p></div></div>
              <div className="tile"><Sliders01 width={22} height={22} aria-hidden /><div><h3>Limits you set</h3><p>Pick the merchants, a cap per payment, a cap per day, and a hard ceiling. Anything over the cap waits for your yes or no.</p></div></div>
              <div className="tile"><FileCheck02 width={22} height={22} aria-hidden /><div><h3>A record of every attempt</h3><p>Blocked payments are written onchain too. After enough of them the contract freezes the agent, and you see what it tried.</p></div></div>
            </div>
          </section>

          <section className="section" id="rein" aria-labelledby="rein-title">
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
                <div className="cta-row" style={{ marginTop: 0 }}>
                  <a href="#demo" className="btn">Try to overspend</a>
                  <Link to="/app" className="link-arrow">Open app</Link>
                </div>
              </div>
              <div className="panel wash reveal">
                <Shapes className="calm" />
                <LiveFeed />
              </div>
            </div>
          </section>

          <section className="section" id="demo" aria-labelledby="demo-title">
            <div className="panel soft demo-panel reveal">
              <Shapes className="calm" />
              <div className="demo-head">
                <h2 id="demo-title">Try to overspend</h2>
                <p className="sub">Send a payment as the agent. Then try the poisoned-page case and watch the rein freeze after three strikes.</p>
              </div>
              <Demo />
            </div>
          </section>

          <section className="section" id="how" aria-labelledby="how-title">
            <h2 id="how-title" className="reveal">How it works</h2>
            <div className="steps stagger">
              <div className="step"><div className="n">1</div><h3>Create a rein</h3><p>Set the agent’s address, your limits and the merchants it may pay. Deposit USDC. It takes an approval and one transaction.</p></div>
              <div className="step"><div className="n">2</div><h3>The agent pays</h3><p>It calls <span className="mono">pay</span> with a recipient, an amount and a memo. The contract answers Paid, Held or Blocked. It never reverts for a rule.</p></div>
              <div className="step"><div className="n">3</div><h3>You stay in charge</h3><p>Approve or deny held payments, freeze the agent, withdraw your balance. The dashboard shows every event as it lands.</p></div>
            </div>

            <div className="code-head reveal" id="developers">
              <h3 style={{ fontSize: 24, fontWeight: 400 }}>For agent builders</h3>
              <a className="link-arrow" href={`${REPO}/tree/main/packages/sdk`} target="_blank" rel="noreferrer">SDK source</a>
            </div>
            <div className="code reveal" role="region" aria-label="SDK example" tabIndex={0}>
              <pre>{`import { createPublicClient, createWalletClient, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRienda, addresses, chainFor, transportFor } from "@rienda/sdk";

const chain = chainFor("testnet"), transport = transportFor("testnet");
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ chain, transport, account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY) });
const rienda = createRienda({ address: addresses.testnet.rienda, publicClient, walletClient });
const r = await rienda.pay({ reinId: 1n, to: "0xMerchant…", amount: parseUnits("2", 6), memo: "News brief" });
console.log(r.outcome, r.reason, r.txHash); `}<span className="c">{`// "Paid" | "Held" | "Blocked", reason, tx`}</span>{`
`}</pre>
            </div>
            <p className="code-note reveal">The SDK lives in the repo and is not on npm yet. Clone it, run <span className="mono">npm install</span> and <span className="mono">npm run build -w packages/sdk</span>. Policy violations return <span className="mono">Blocked</span>. Only invalid calls, like a frozen rein, throw.</p>
          </section>

          <section className="section" id="trust" aria-labelledby="trust-title">
            <div className="duo">
              <div className="reveal">
                <h2 id="trust-title">Where the money is, and who can move it</h2>
                <p className="sub">USDC stays in the contract. The agent can’t withdraw it and can’t send it to an address you didn’t list. Only you can deposit, withdraw, approve or unfreeze.</p>
                <p className="caveat">Rienda is unaudited and runs on {chain.name} only. It limits the damage from a fooled agent. It does not protect you from a stolen owner key or a bad merchant you chose to allow.</p>
              </div>
              <div className="trust-links reveal">
                {RIENDA && <a href={addressUrl(RIENDA)} target="_blank" rel="noreferrer"><span>Contract on the explorer</span><span className="mono">{shortAddr(RIENDA)}</span></a>}
                <a href={`${REPO}/blob/main/contracts/src/Rienda.sol`} target="_blank" rel="noreferrer"><span>Contract source</span><span className="mono">Rienda.sol</span></a>
                <a href={`${REPO}/blob/main/docs/threat-model.md`} target="_blank" rel="noreferrer"><span>Threat model</span><span className="mono">docs/threat-model.md</span></a>
                <a href={`${REPO}/blob/main/contracts/test/Rienda.t.sol`} target="_blank" rel="noreferrer"><span>Tests for every rule</span><span className="mono">Rienda.t.sol</span></a>
              </div>
            </div>
            <div className="facts stagger">
              <div><div className="fact-n"><CountUp to={1045} suffix=" ms" /></div><p>Median time for a payment to confirm on testnet, over 10 runs.</p></div>
              <div><div className="fact-n"><CountUp to={79} /></div><p>Unit tests, one per rule and edge case, plus fuzz and invariant tests. Run them with <span className="mono">forge test</span>.</p></div>
              <div><div className="fact-n"><CountUp to={6} /></div><p>Checks on every payment, always in the same order.</p></div>
            </div>
          </section>
        </main>

        <footer className="footer">
          <div>
            <Link to="/" className="wordmark"><span className="mark" aria-hidden />Rienda</Link>
            <p className="small">Spending limits for AI agents on Monad. MIT licensed.</p>
          </div>
          <nav aria-label="Footer">
            <Link to="/app">Open app</Link>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
            <a href={`${REPO}/blob/main/docs/architecture.md`} target="_blank" rel="noreferrer">Architecture</a>
            <a href={`${REPO}/blob/main/docs/threat-model.md`} target="_blank" rel="noreferrer">Threat model</a>
            {RIENDA && <a href={addressUrl(RIENDA)} target="_blank" rel="noreferrer">Contract</a>}
          </nav>
        </footer>
      </div>
    </>
  );
}
