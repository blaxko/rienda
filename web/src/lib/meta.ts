import { useEffect } from "react";

const BASE = "https://rienda-production.up.railway.app";

function setMeta(sel: string, attr: string, value: string) {
  document.head.querySelector<HTMLMetaElement>(sel)?.setAttribute(attr, value);
}

/** Sets the tab title and the description / social tags for the current page. */
export function usePageMeta(title: string, description: string, path: string) {
  useEffect(() => {
    document.title = title;
    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[property="og:title"]', "content", title);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:url"]', "content", `${BASE}${path}`);
    setMeta('meta[name="twitter:title"]', "content", title);
    setMeta('meta[name="twitter:description"]', "content", description);
  }, [title, description, path]);
}
