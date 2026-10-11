import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, Wallet01 } from "@untitledui/icons";
import { Link } from "../router";
import { chain, rienda } from "../config";
import { useDecimals, useWallet } from "../hooks";
import { fmtUsdc, shortAddr } from "../lib/format";
import { ConnectButton } from "../components/ConnectModal";

export function Reins() {
  const w = useWallet();
  const decimals = useDecimals();
  const q = useQuery({
    queryKey: ["reins", chain.id, w.address],
    enabled: !!rienda && w.isConnected,
    queryFn: () => rienda!.getReins({ owner: w.address! }),
    refetchInterval: 5000,
  });

  // Every state renders something visible: never a blank page.
  let body;
  if (!rienda) {
    body = (
      <div className="empty">
        <div className="icon"><AlertTriangle width={22} height={22} aria-hidden /></div>
        <h2>Not deployed yet</h2>
        <p>Rienda has no contract on {chain.name} yet, so there is nothing to show.</p>
      </div>
    );
  } else if (!w.isConnected) {
    body = (
      <div className="empty">
        <div className="icon"><Wallet01 width={22} height={22} aria-hidden /></div>
        <h2>Connect your wallet</h2>
        <p>Your reins are tied to the wallet that created them. Connect it to see them. Rienda never moves funds without a transaction you sign.</p>
        <ConnectButton />
      </div>
    );
  } else if (q.error) {
    body = (
      <div className="banner banner-red" role="alert">
        <AlertTriangle width={18} height={18} aria-hidden />
        <span>Could not load your reins: {(q.error as Error).message}</span>
        <button className="btn small" onClick={() => q.refetch()}>Try again</button>
      </div>
    );
  } else if (q.isLoading || !q.data) {
    body = (
      <div className="cards" aria-busy="true" aria-label="Loading your reins">
        {[0, 1, 2].map((i) => (
          <div className="card" key={i}>
            <div className="skeleton" style={{ height: 28, width: "50%" }} />
            <div className="skeleton" style={{ height: 44, width: "70%", marginTop: 20 }} />
            <div className="skeleton" style={{ height: 16, width: "90%", marginTop: 20 }} />
          </div>
        ))}
      </div>
    );
  } else if (q.data.length === 0) {
    body = (
      <div className="empty">
        <div className="icon"><Plus width={22} height={22} aria-hidden /></div>
        <h2>No reins yet</h2>
        <p>A rein sets what your agent may spend and who it may pay. Create one to get started.</p>
        <Link to="/new" className="btn">Create a rein</Link>
      </div>
    );
  } else {
    body = (
      <div className="cards">
        {q.data.map(({ id, rein }) => (
          <Link key={id.toString()} to={`/rein/${id}`} className="card link-card">
            <div className="row">
              <strong>Rein #{id.toString()}</strong>
              <span className={`status status-${rein.status}`}>{rein.status}</span>
            </div>
            <div className="big">${fmtUsdc(rein.balance, decimals)}</div>
            <div className="muted">Agent <span className="mono">{shortAddr(rein.agent)}</span> · Strikes {rein.strikes} of {rein.maxStrikes}</div>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <section>
      <div className="page-head">
        <h1>My reins</h1>
        {w.isConnected && rienda && <Link to="/new" className="btn small" style={{ marginLeft: "auto" }}>New rein</Link>}
      </div>
      {body}
    </section>
  );
}
