import raw from "../../../brand/rienda-mark.svg?raw";

// brand/rienda-mark.svg is the only source of the mark. Its fill becomes currentColor so it can turn white on dark.
const viewBox = /viewBox="([^"]+)"/.exec(raw)![1]!;
const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/fill="#111111"/gi, 'fill="currentColor"');

/** The Rienda mark: a calligraphic R made of two brush strokes. */
export function RiendaMark({ size = 40 }: { size?: number }) {
  return <svg className="mark" width={size} height={size} viewBox={viewBox} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: inner }} />;
}
