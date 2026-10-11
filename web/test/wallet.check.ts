import assert from "node:assert/strict";
import { chainFor } from "@rienda/sdk";
import { chainAddParams, classifyConnectError, metamaskDeepLink, walletOptions, withTimeout, ConnectTimeoutError } from "../src/lib/wallet";
import { pay, initialDemo, decide } from "../src/lib/simulate";
import { cleanAddress, parseAddress } from "../src/lib/address";

// chain-add params: Monad Testnet 10143, our RPC, MON, MonadVision
const p = chainAddParams(chainFor("testnet"));
assert.equal(p.chainId, "0x279f");
assert.deepEqual(p.rpcUrls, ["https://testnet-rpc.monad.xyz"]);
assert.equal(p.nativeCurrency.symbol, "MON");
assert.deepEqual(p.blockExplorerUrls, ["https://testnet.monadvision.com"]);

// error classes
assert.equal(classifyConnectError({ code: 4001 }).kind, "rejected");
assert.equal(classifyConnectError({ name: "UserRejectedRequestError", message: "User rejected" }).kind, "rejected");
assert.equal(classifyConnectError({ name: "ProviderNotFoundError" }, "Rabby").kind, "not-installed");
assert.equal(classifyConnectError(new ConnectTimeoutError("x")).kind, "timeout");
assert.equal(classifyConnectError(new Error("boom")).kind, "other");
await assert.rejects(withTimeout(new Promise(() => {}), 20), ConnectTimeoutError);
assert.equal(await withTimeout(Promise.resolve(7), 20), 7);

// wallet list: announced wallets listed with name/icon; coinbase SDK dropped when the extension announced; WC only if present
const c = (id: string, type: string, name: string, icon?: string) => ({ id, type, name, icon, uid: id }) as never;
const base = [c("injected", "injected", "Injected"), c("coinbaseWalletSDK", "coinbaseWallet", "Coinbase Wallet")];
const announced = [c("io.metamask", "injected", "MetaMask", "data:a"), c("io.rabby", "injected", "Rabby Wallet", "data:b"), c("app.phantom", "injected", "Phantom", "data:c")];
let o = walletOptions([...base, ...announced], { hasLegacyProvider: true });
assert.deepEqual(o.map((x) => x.name), ["MetaMask", "Rabby Wallet", "Phantom", "Coinbase Wallet"]);
assert.ok(o.every((x) => x.kind !== "walletconnect"), "no WalletConnect without a project id");
o = walletOptions([...base, c("com.coinbase.wallet", "injected", "Coinbase Wallet", "data:d"), c("walletConnect", "walletConnect", "WalletConnect")], { hasLegacyProvider: false });
assert.deepEqual(o.map((x) => x.name), ["Coinbase Wallet", "WalletConnect"]);
assert.equal(o[0]!.kind, "injected");
o = walletOptions([...base], { hasLegacyProvider: true });
assert.deepEqual(o.map((x) => x.name), ["Browser wallet", "Coinbase Wallet"]);
assert.equal(walletOptions([...base], { hasLegacyProvider: false }).length, 1);

assert.equal(metamaskDeepLink({ host: "rienda.app", pathname: "/rein/1", search: "" }), "https://metamask.app.link/dapp/rienda.app/rein/1");

// demo rules (same order as the contract)
let s = initialDemo();
s = pay(s, "news", 2); s = pay(s, "gpu", 4); s = pay(s, "gpu", 12);
assert.equal(s.held.length, 1);
s = decide(s, s.held[0]!.id, true);
assert.equal(s.balance, 12);
for (let i = 0; i < 3; i++) s = pay(s, "unknown", 500);
assert.ok(s.frozen && s.strikes === 3 && s.balance === 12);
assert.equal(pay(s, "news", 2).events[0]!.outcome, "Reverted");

// address inputs: the agent, any case, stray whitespace and invisible characters
const AGENT = "0x83e0171F8f03FCcc280205A9c6116e1dF26761B3";
for (const v of [AGENT, `  ${AGENT}  `, `${AGENT}\n`, AGENT.toLowerCase(), "0x" + AGENT.slice(2).toUpperCase(), `\u200B${AGENT}`, `${AGENT}\u200E`, `\u00A0${AGENT}\t`, `"${AGENT}"`, "0X" + AGENT.slice(2)]) {
  assert.equal(parseAddress(v), AGENT, JSON.stringify(v));
}
assert.equal(cleanAddress(` \u200B${AGENT}\n`), AGENT);
for (const v of ["", "0x", AGENT.slice(0, -1), AGENT + "0", "0x" + "g".repeat(40), "0x" + "0".repeat(40), "83e0171F8f03FCcc280205A9c6116e1dF26761B3"]) {
  assert.equal(parseAddress(v), null, JSON.stringify(v));
}

console.log("web checks passed");
