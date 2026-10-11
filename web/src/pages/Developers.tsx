import { PageCta, PageHead } from "../components/PageBits";
import { usePageMeta } from "../lib/meta";
import { SITE_META } from "../lib/routes";

const REPO = "https://github.com/blaxko/rienda";

export function Developers() {
  usePageMeta(SITE_META["/developers"]!.title, SITE_META["/developers"]!.description, "/developers");
  return (
    <>
      <PageHead title="Pay through a rein from your agent." lede="The agent is a plain wallet with a little MON for gas. It calls one function." />
      <div className="page-grid dev-grid">
        <div className="prose stagger">
          <p>The SDK is in the repo, in <span className="mono">packages/sdk</span>. It is not on npm yet, so clone it and build it:</p>
          <pre className="code-inline"><code>{`git clone ${REPO}.git && cd rienda
npm install
npm run build -w packages/sdk`}</code></pre>
          <p>Save the example on the right as a <span className="mono">.ts</span> file inside the clone (for example <span className="mono">agent/try.ts</span>, so <span className="mono">@rienda/sdk</span> resolves to the workspace package), put the agent key in the environment and run it:</p>
          <pre className="code-inline"><code>{`AGENT_PRIVATE_KEY=0x… npx tsx agent/try.ts`}</code></pre>
          <p><span className="mono">pay</span> simulates the call first, sends it with a fixed gas limit (Monad charges the limit you declare, not the gas used), waits for the receipt and decodes the outcome.</p>
          <p>A rule violation does not throw. It returns <span className="mono">Blocked</span> with a reason. Only invalid calls throw, such as a frozen rein or a wallet that is not the agent.</p>
          <p>Also in the SDK: <span className="mono">getRein</span>, <span className="mono">getReins</span>, <span className="mono">getRequests</span> and <span className="mono">watch</span>.</p>
        </div>
        <div className="code reveal" role="region" aria-label="SDK example" tabIndex={0}>
          <pre>{`import { createPublicClient, createWalletClient, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRienda, addresses, chainFor, transportFor } from "@rienda/sdk";

const chain = chainFor("testnet"), transport = transportFor("testnet");
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ chain, transport, account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY) });
const rienda = createRienda({ address: addresses.testnet.rienda, publicClient, walletClient });
const r = await rienda.pay({ reinId: 2n, to: "0xMerchant…", amount: parseUnits("2", 6), memo: "News brief" });
console.log(r.outcome, r.reason, r.txHash); `}<span className="c">{`// "Paid" | "Held" | "Blocked", reason, tx`}</span>{`
`}</pre>
        </div>
      </div>
      <PageCta to="/app" label="Open app" more={{ to: REPO + "/tree/main/packages/sdk", label: "SDK source on GitHub" }} />
    </>
  );
}
