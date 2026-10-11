import { useEffect, type ReactElement } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header, NetworkGuard } from "./components/Header";
import { Shapes } from "./components/Shapes";
import { SiteLayout } from "./components/SiteLayout";
import { Link, usePath } from "./router";
import { usePageMeta } from "./lib/meta";
import { About } from "./pages/About";
import { Developers } from "./pages/Developers";
import { HowItWorks } from "./pages/HowItWorks";
import { Landing } from "./pages/Landing";
import { Security } from "./pages/Security";
import { Try } from "./pages/Try";
import { Reins } from "./pages/Reins";
import { NewRein } from "./pages/NewRein";
import { ReinPage } from "./pages/Rein";

// marketing pages, each with its own route, title and description
const SITE: Record<string, () => ReactElement> = {
  "/": Landing,
  "/about": About,
  "/how-it-works": HowItWorks,
  "/try": Try,
  "/developers": Developers,
  "/security": Security,
};

function AppMeta({ path }: { path: string }) {
  usePageMeta(path === "/new" ? "New rein · Rienda" : path === "/app" ? "My reins · Rienda" : "Rein · Rienda", "Set what your agent may spend, approve held payments, and see every blocked attempt.", path);
  return null;
}

export function App() {
  const raw = usePath();
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw || "/";
  useEffect(() => window.scrollTo(0, 0), [path]);

  const Site = SITE[path];
  if (Site) {
    return (
      <SiteLayout>
        <ErrorBoundary key={path}><Site /></ErrorBoundary>
      </SiteLayout>
    );
  }

  const m = /^\/rein\/(\d+)$/.exec(path);
  let page;
  if (path === "/app") page = <Reins />;
  else if (path === "/new") page = <NewRein />;
  else if (m) page = <ReinPage reinId={BigInt(m[1]!)} />;
  else
    page = (
      <div className="empty">
        <h2>Page not found</h2>
        <p>That address doesn't lead anywhere.</p>
        <Link to="/app" className="btn">Go to my reins</Link>
      </div>
    );

  return (
    <>
      <div className="app-bg"><Shapes /></div>
      <Header />
      <AppMeta path={path} />
      <NetworkGuard />
      <main className="main">
        <ErrorBoundary key={path}>{page}</ErrorBoundary>
      </main>
    </>
  );
}
