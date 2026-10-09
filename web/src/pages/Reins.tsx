import { useQuery } from "@tanstack/react-query";
import { Link } from "../router";
import { chain, rienda } from "../config";
import { useDecimals, useWallet } from "../hooks";
import { fmtUsdc, shortAddr } from "../lib/format";

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
    body = <p className="muted">Rienda is not deployed on {chain.name} yet.</p>;
  } else if (!w.isConnected) {
    body = <p className="muted">Connect your wallet to see your reins.</p>;
  } else if (q.error) {
    body = <p className="tx tx-err">Could not load your reins: {(q.error as Error).message}</p>;
  } else if (q.isLoading || !q.data) {
    body = <p className="muted">Loading your reins…</p>;
  } else if (q.data.length === 0) {
    body = (
      <div className="card">
        <p style={{ marginTop: 0 }}><strong>No reins yet.</strong></p>
        <p className="muted">A rein sets what your agent may spend and who it may pay.</p>
        <Link to="/new"><button>New rein</button></Link>
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
            <div className="muted">Balance ${fmtUsdc(rein.balance, decimals)}</div>
            <div className="muted">Agent {shortAddr(rein.agent)}</div>
            <div className="muted">Strikes {rein.strikes}/{rein.maxStrikes}</div>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <section>
      <h1>My reins</h1>
      {body}
    </section>
  );
}
