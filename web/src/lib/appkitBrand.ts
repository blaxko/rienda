import { markSvg } from "../components/Logo";

/**
 * AppKit has no option for a logo in its header, so we place Rienda's mark in the modal ourselves.
 * The modal lives in a shadow root; its card is a stable element in the pinned AppKit version. A MutationObserver
 * puts our row back if the modal re-renders, and stops when the modal closes.
 */
type Modal = { subscribeState: (cb: (s: { open: boolean }) => void) => () => void };

function row(): HTMLElement {
  const el = document.createElement("div");
  el.className = "rienda-brand";
  el.style.cssText = "display:flex;align-items:center;gap:10px;padding:18px 20px 2px;color:var(--wui-color-fg-100,#14110F);font:500 20px/1 var(--wui-font-family,Geist,system-ui,sans-serif);letter-spacing:-.02em";
  el.innerHTML = `${markSvg(30)}<span>Rienda</span>`;
  return el;
}

export function brandAppKit(modal: Modal) {
  let obs: MutationObserver | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { obs?.disconnect(); obs = undefined; clearInterval(timer); };

  const place = (): boolean => {
    const card = document.querySelector("w3m-modal")?.shadowRoot?.querySelector("wui-card");
    if (!card) return false;
    if (!card.querySelector(".rienda-brand")) card.insertBefore(row(), card.firstChild);
    if (!obs) { obs = new MutationObserver(() => { if (!card.querySelector(".rienda-brand")) card.insertBefore(row(), card.firstChild); }); obs.observe(card, { childList: true }); }
    return true;
  };

  modal.subscribeState(({ open }) => {
    stop();
    if (!open) return;
    if (place()) return;
    let tries = 0;
    timer = setInterval(() => { if (place() || ++tries > 60) clearInterval(timer); }, 50);
  });
}
