import { Header, NetworkGuard } from "./components/Header";
import { usePath } from "./router";
import { Reins } from "./pages/Reins";
import { NewRein } from "./pages/NewRein";
import { ReinPage } from "./pages/Rein";

export function App() {
  const path = usePath();
  const m = /^\/rein\/(\d+)\/?$/.exec(path);
  let page;
  if (path === "/" || path === "") page = <Reins />;
  else if (path === "/new") page = <NewRein />;
  else if (m) page = <ReinPage reinId={BigInt(m[1]!)} />;
  else page = <p>Page not found.</p>;

  return (
    <>
      <Header />
      <NetworkGuard />
      <main className="main">{page}</main>
    </>
  );
}
