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

  return (
    <section>
      <h1>My reins</h1>
      {!w.isConnected && <p className="muted">Connect your owner wallet to see your reins.</p>}
      {w.isConnected && q.isLoading && <p className="muted">Loading…</p>}
      {q.error && <p className="tx tx-err">Could not load reins: {(q.error as Error).message}</p>}
      {q.data && q.data.length === 0 && (
        <p className="muted">
          You have no reins on {chain.name}. <Link to="/new">Create one</Link>.
        </p>
      )}
      <div className="cards">
        {q.data?.map(({ id, rein }) => (
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
    </section>
  );
}
