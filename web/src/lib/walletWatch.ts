import { useSyncExternalStore } from "react";
import { ConnectionController } from "@reown/appkit-controllers";

/**
 * Watches the wallet pairing so a failure shows up as a clear message instead of an endless spinner.
 * Trouble means one of:
 *   - after the user picks a mobile or QR wallet, no pairing link (wc: URI) exists after 20 seconds
 *   - AppKit reports a connect error, or the relay refuses the publish ("Failed to publish custom payload")
 */
const dbg = (...a: unknown[]) => console.debug("[rienda/wallet]", ...a);

export type WalletTrouble = { reason: "timeout" | "relay"; wallet?: string };

type Modal = {
  open: (o?: { view: "Connect" }) => Promise<unknown> | void;
  close: () => Promise<unknown> | void;
  subscribeEvents: (cb: (e: { data: { event: string; properties?: { name?: string; platform?: string } } }) => void) => () => void;
};

let current: WalletTrouble | null = null;
let rearm: () => void = () => {};
let modalRef: Modal | null = null;
const subs = new Set<() => void>();
const set = (t: WalletTrouble | null) => { if ((t === null) !== (current === null)) dbg("trouble ->", t ? t.reason : "cleared"); current = t; subs.forEach((f) => f()); };

export const useWalletTrouble = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
export const dismissWalletTrouble = () => set(null);

/** Start over: close the modal, drop the half-made pairing, and open the wallet list again. */
export async function retryPairing() {
  set(null);
  try { await modalRef?.close(); } catch { /* already closed */ }
  try { ConnectionController.resetWcConnection(); ConnectionController.resetUri(); } catch { /* nothing to reset */ }
  // a stale half-open pairing is what usually keeps the next attempt stuck; sessions are only touched when nothing is connected
  try { for (const k of Object.keys(localStorage)) if (/^wc@2:(core:0\.3\/\/pairing|core:0\.3\/\/messages|core:0\.3\/\/subscription|core:0\.3\/\/expirer)/.test(k)) localStorage.removeItem(k); } catch { /* storage blocked */ }
  rearm();
  setTimeout(() => { void modalRef?.open({ view: "Connect" }); }, 250);
}

const RELAY_ERR = /failed to publish|publish custom payload|socket stalled|websocket connection failed|relay.*(error|failed)/i;

export function watchPairing(modal: Modal) {
  modalRef = modal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting = false;
  let gaveUpOn: string | undefined; // AppKit keeps retrying the same wallet in the background after we show the sheet
  const stop = () => { clearTimeout(timer); timer = undefined; waiting = false; };
  const raise = (t: WalletTrouble) => { dbg("raise", t.reason); stop(); gaveUpOn = t.wallet ?? "?"; set(t); };
  rearm = () => { gaveUpOn = undefined; };

  modal.subscribeEvents(({ data }) => {
    dbg("event", data.event, data.properties?.name ?? "", data.properties?.platform ?? "", (data.properties as { view?: string } | undefined)?.view ?? "");
    switch (data.event) {
      case "SELECT_WALLET": {
        // AppKit fires this again by itself on every internal retry (about every 10 s); keep the first timer for the attempt
        if (waiting) return;
        const wallet = data.properties?.name;
        if (gaveUpOn !== undefined && gaveUpOn === (wallet ?? "?")) return; // the same wallet being retried by AppKit: don't bring the sheet back
        gaveUpOn = undefined;
        stop(); set(null);
        if (data.properties?.platform === "browser") return; // a wallet extension: nothing to pair
        waiting = true;
        timer = setTimeout(() => { dbg("20s check", { waiting, hasUri: !!ConnectionController.state.wcUri, wcError: ConnectionController.state.wcError }); if (waiting && !ConnectionController.state.wcUri) raise({ reason: "timeout", wallet }); }, 20_000);
        break;
      }
      case "CONNECT_SUCCESS":
      case "MODAL_CLOSE":
        stop(); gaveUpOn = undefined; if (data.event === "CONNECT_SUCCESS") set(null);
        break;
      case "CONNECT_ERROR":
        if (waiting) raise({ reason: "relay" });
        break;
    }
  });
  ConnectionController.subscribeKey("wcUri", (uri) => { if (uri && timer) { clearTimeout(timer); timer = undefined; } });
  ConnectionController.subscribeKey("wcError", (err) => { if (err && waiting) raise({ reason: "relay" }); });
  const onFail = (msg: unknown) => { if (waiting && RELAY_ERR.test(String(msg))) raise({ reason: "relay" }); };
  window.addEventListener("error", (e) => onFail(e.message));
  window.addEventListener("unhandledrejection", (e) => onFail((e.reason as Error)?.message ?? e.reason));
}
