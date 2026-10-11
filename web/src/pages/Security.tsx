import { PageCta, PageHead } from "../components/PageBits";
import { CountUp } from "../lib/motion";
import { RIENDA, addressUrl, chain } from "../config";
import { shortAddr } from "../lib/format";
import { usePageMeta } from "../lib/meta";
import { SITE_META } from "../lib/routes";
import { RiendaMark } from "../components/Logo";

const REPO = "https://github.com/blaxko/rienda";

export function Security() {
  usePageMeta(SITE_META["/security"]!.title, SITE_META["/security"]!.description, "/security");
  return (
    <>
      <PageHead title="Where the money is, and who can move it." />
      <div className="page-grid">
        <div className="prose stagger">
          <p><strong>Non-custodial for the agent.</strong> USDC stays in the contract. The agent wallet holds only MON for gas, so a stolen agent key can’t take your balance.</p>
          <p><strong>Limits live onchain.</strong> The contract enforces the merchant list, the caps and the strike count. Neither the agent nor the dashboard can bypass them.</p>
          <p><strong>Only you move the funds.</strong> Deposit, withdraw, approve, deny, freeze and unfreeze are owner-only. Payments go to a merchant you listed, or back to you.</p>
          <p><strong>Verifiable.</strong> The source is public and the deployed contract is verified. The tests cover every rule and edge case.</p>
          <p className="caveat">Rienda is unaudited and runs on {chain.name} only. It limits the damage from a fooled agent. It does not protect you from a stolen owner key, a bug in the contract, or a merchant you chose to allow.</p>
        </div>
        <div className="visual reveal">
          <figure className="money-path" aria-label="How money moves">
            <div className="mp-node"><span>You</span><small>deposit, approve, withdraw</small></div>
            <div className="mp-arrow" aria-hidden />
            <div className="mp-node mp-contract"><RiendaMark size={34} /><span>Rienda contract</span><small>holds the USDC, checks every payment</small></div>
            <div className="mp-arrow" aria-hidden />
            <div className="mp-node"><span>Merchants you listed</span><small>the only recipients</small></div>
            <div className="mp-agent"><span>Your agent</span><small>holds MON only, calls <span className="mono">pay</span></small></div>
          </figure>
          <div className="trust-links">
            {RIENDA && <a href={addressUrl(RIENDA)} target="_blank" rel="noreferrer"><span>Contract on the explorer</span><span className="mono">{shortAddr(RIENDA)}</span></a>}
            <a href={`${REPO}/blob/main/contracts/src/Rienda.sol`} target="_blank" rel="noreferrer"><span>Contract source</span><span className="mono">Rienda.sol</span></a>
            <a href={`${REPO}/blob/main/docs/threat-model.md`} target="_blank" rel="noreferrer"><span>Threat model</span><span className="mono">docs/threat-model.md</span></a>
            <a href={`${REPO}/blob/main/contracts/test/Rienda.t.sol`} target="_blank" rel="noreferrer"><span>Tests for every rule</span><span className="mono">Rienda.t.sol</span></a>
          </div>
        </div>
      </div>
      <div className="facts stagger">
        <div><div className="fact-n"><CountUp to={1045} suffix=" ms" /></div><p>Median time for a payment to confirm on testnet, over 10 runs.</p></div>
        <div><div className="fact-n"><CountUp to={88} /></div><p>Tests: 79 unit, 7 fuzz, 1 invariant and 1 gas. Run them with <span className="mono">forge test</span>.</p></div>
        <div><div className="fact-n"><CountUp to={6} /></div><p>Checks on every payment, always in the same order.</p></div>
      </div>
      <PageCta to={`${REPO}/blob/main/docs/threat-model.md`} label="Read the threat model" />
    </>
  );
}
