import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header, NetworkGuard } from "./components/Header";
import { Link, usePath } from "./router";
import { Shapes } from "./components/Shapes";
import { Landing } from "./pages/Landing";
import { Reins } from "./pages/Reins";
import { NewRein } from "./pages/NewRein";
import { ReinPage } from "./pages/Rein";

export function App() {
  const path = usePath();
  if (path === "/" || path === "") return <Landing />;

  const m = /^\/rein\/(\d+)\/?$/.exec(path);
  let page;
  if (path === "/app" || path === "/app/") page = <Reins />;
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
      <NetworkGuard />
      <main className="main">
        <ErrorBoundary key={path}>{page}</ErrorBoundary>
      </main>
    </>
  );
}
