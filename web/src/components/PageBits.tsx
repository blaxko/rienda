import type { ReactNode } from "react";
import { Link } from "../router";

/** Internal route or external URL. */
function Go({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return /^https?:/.test(to) ? <a href={to} className={className} target="_blank" rel="noreferrer">{children}</a> : <Link to={to} className={className}>{children}</Link>;
}
import { ReinLine } from "./ReinLine";

/** Headline block for an inner page. */
export function PageHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="page-hero">
      <h1 className="reveal">{title}</h1>
      {lede && <p className="lede reveal">{lede}</p>}
    </header>
  );
}

/** A divider made of the rein line. */
export function ReinDivider() {
  return <div className="rein-divider" aria-hidden="true"><ReinLine className="divider-line" /></div>;
}

/** The one call to action at the end of an inner page. */
export function PageCta({ children, to = "/app", label = "Open app", more }: { children?: ReactNode; to?: string; label?: string; more?: { to: string; label: string } }) {
  return (
    <section className="page-cta reveal">
      {children && <p>{children}</p>}
      <div className="cta-row" style={{ marginTop: children ? 24 : 0 }}>
        <Go to={to} className="btn large">{label}</Go>
        {more && <Go to={more.to} className="link-arrow">{more.label}</Go>}
      </div>
    </section>
  );
}

/** Link at the end of a landing teaser. It names where it goes, and the arrow comes from CSS. */
export function ReadMore({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="link-arrow read-more">{children}</Link>;
}
