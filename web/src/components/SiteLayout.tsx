import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { XClose } from "@untitledui/icons";
import { Link, usePath } from "../router";
import { RIENDA, addressUrl, chain } from "../config";
import { useRevealOnScroll } from "../lib/motion";
import { RiendaMark } from "./Logo";

const REPO = "https://github.com/blaxko/rienda";

export const SITE_NAV = [
  { to: "/about", label: "What it is" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/try", label: "Try it" },
  { to: "/developers", label: "Developers" },
  { to: "/security", label: "Trust" },
] as const;

/** Full-screen solid menu for phones: paper, 56px rows, Open app at the bottom. Locks scroll, closes on Escape and route change, traps focus. */
function MobileSheet({ open, onClose, path }: { open: boolean; onClose: () => void; path: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    const focusables = () => [...root.querySelectorAll<HTMLElement>("a[href], button")].filter((e) => !e.hasAttribute("disabled"));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = overflow;
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);

  // route change closes the sheet
  const first = useRef(path);
  useEffect(() => {
    if (first.current !== path) { first.current = path; onClose(); }
  }, [path, onClose]);

  if (!open) return null;
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Menu" ref={ref}>
      <div className="sheet-top">
        <Link to="/" className="wordmark"><RiendaMark />Rienda</Link>
        <button className="icon-btn" onClick={onClose} aria-label="Close menu"><XClose width={24} height={24} aria-hidden /></button>
      </div>
      <nav aria-label="Main" className="sheet-links">
        {SITE_NAV.map((l) => (
          <Link key={l.to} to={l.to} aria-current={path === l.to ? "page" : undefined}>{l.label}</Link>
        ))}
      </nav>
      <div className="sheet-bottom">
        <span className="pill net">{chain.name}</span>
        <Link to="/app" className="btn large">Open app</Link>
      </div>
    </div>
  );
}

/** Nav, page content and footer for every marketing page. */
export function SiteLayout({ children }: { children: ReactNode }) {
  const path = usePath();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  useRevealOnScroll(path);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <>
      <div className={`nav-wrap ${scrolled ? "scrolled" : ""}`}>
        <div className="wrap">
          <header className="nav">
            <Link to="/" className="wordmark" aria-label="Rienda home"><RiendaMark />Rienda</Link>
            <nav className="nav-links" aria-label="Main">
              {SITE_NAV.map((l) => (
                <Link key={l.to} to={l.to} aria-current={path === l.to ? "page" : undefined}>{l.label}</Link>
              ))}
            </nav>
            <div className="nav-end">
              <Link to="/developers" className="btn small ghost nav-docs">Read the docs</Link>
              <Link to="/app" className="btn small nav-cta">Open app</Link>
              <button className="nav-menu" aria-haspopup="dialog" aria-expanded={menu} aria-label="Open menu" onClick={() => setMenu(true)}>
                <span className="burger" aria-hidden />
              </button>
            </div>
          </header>
        </div>
      </div>
      <MobileSheet open={menu} onClose={closeMenu} path={path} />

      <div className="wrap">
        <main id="main">{children}</main>
        <footer className="footer">
          <div>
            <Link to="/" className="wordmark"><RiendaMark />Rienda</Link>
            <p className="small">Spending limits for AI agents on Monad. MIT licensed.</p>
            <p className="net-line" title={RIENDA ?? undefined}><span className="net-dot" aria-hidden />{chain.name}</p>
          </div>
          <nav aria-label="Footer">
            {SITE_NAV.map((l) => <Link key={l.to} to={l.to}>{l.label}</Link>)}
            <Link to="/app">Open app</Link>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
            {RIENDA && <a href={addressUrl(RIENDA)} target="_blank" rel="noreferrer">Contract</a>}
          </nav>
        </footer>
      </div>
    </>
  );
}
