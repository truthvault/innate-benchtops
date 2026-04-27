/**
 * Renders the customer's actual benchtop layout as a PNG, suitable for
 * inlining into an HTML email. Mirrors the geometry approach SlabPreview
 * uses on the frontend (panels in a row separated by a fixed gap, scale
 * chosen so the whole arrangement fits the canvas) but stripped down to
 * a clean outline + cutout markers. No drag, no wood texture, no live
 * editing.
 *
 * resvg-js is loaded lazily inside the renderer rather than via static
 * import so a missing platform binary on Vercel can't crash the whole
 * function before the handler runs. If the binary load fails, the
 * renderer returns null.
 *
 * TODO (deferred from Prompt 8c): the email integration is currently OFF.
 * api/send-quote.ts no longer calls renderLayoutPng() because the inline
 * base64 data URI approach was rejected by Gmail's image proxy and shipped
 * as broken-image placeholders. The recommended re-enable path is to ship
 * the PNG as a Resend message attachment with a `cid:` reference in the
 * <img src="cid:layout"> tag. The vercel.json `functions.includeFiles`
 * glob and the @resvg/resvg-js dependency are kept in place for that
 * follow-up so it's a small change rather than a re-litigation of the
 * native-binary bundling work.
 */

import { createRequire } from "node:module";

interface LayoutPanel {
  length: number;
  width: number;
  cutouts: Array<{
    widthMm: number;
    depthMm: number;
    pos: number;
    cross: number;
  }>;
}

const VIEW_W = 1200;
const VIEW_H = 480;
const PAD_TOP = 36;
const PAD_RIGHT = 36;
const PAD_BOTTOM = 60;
const PAD_LEFT = 84;
const GAP_MM = 80;

const COL_PAPER = "#f3f0ee";
const COL_INK = "#163832";
const COL_FAINT = "#14141399";
const COL_CUTOUT = "#0c201c";

/** Build the SVG markup for a layout. Pure function — no IO. */
export function buildLayoutSvg(panels: LayoutPanel[]): string {
  if (panels.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}"><rect width="${VIEW_W}" height="${VIEW_H}" fill="#ffffff"/></svg>`;
  }

  const totalLen =
    panels.reduce((s, p) => s + p.length, 0) +
    GAP_MM * Math.max(0, panels.length - 1);
  const maxWid = Math.max(...panels.map((p) => p.width), 200);
  const availW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const availH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const scale = Math.min(availW / totalLen, availH / maxWid);

  const laidWidth = totalLen * scale;
  const startX = PAD_LEFT + (availW - laidWidth) / 2;
  const centreY = PAD_TOP + (availH - maxWid * scale) / 2;

  let cx = startX;
  const panelEls: string[] = [];
  const cutoutEls: string[] = [];
  const dimEls: string[] = [];

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const w = p.length * scale;
    const h = p.width * scale;
    const x = cx;
    const y = centreY + (maxWid * scale - h) / 2;

    // Panel: cream fill, dark green hairline border. Rounded corners
    // match the configurator's visual identity.
    panelEls.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="8" ry="8" fill="${COL_PAPER}" stroke="${COL_INK}" stroke-width="1.6"/>`,
    );

    // Length label below this panel.
    dimEls.push(
      `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h + 30).toFixed(1)}" text-anchor="middle" fill="${COL_FAINT}" font-size="22" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">${p.length} mm</text>`,
    );

    // Width label to the left of the first panel only — keeps things uncluttered.
    if (i === 0) {
      dimEls.push(
        `<text x="${(x - 14).toFixed(1)}" y="${(y + h / 2).toFixed(1)}" text-anchor="end" dominant-baseline="middle" fill="${COL_FAINT}" font-size="22" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">${p.width} mm</text>`,
      );
    }

    // Cutouts as filled dark rectangles. pos/cross are centre-fractions
    // along/across the panel, matching the schema in src/pricing.ts.
    for (const c of p.cutouts) {
      const cw = c.widthMm * scale;
      const ch = c.depthMm * scale;
      const cxPx = x + c.pos * w - cw / 2;
      const cyPx = y + c.cross * h - ch / 2;
      cutoutEls.push(
        `<rect x="${cxPx.toFixed(1)}" y="${cyPx.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="3" ry="3" fill="${COL_CUTOUT}" opacity="0.88"/>`,
      );
    }

    cx += w + GAP_MM * scale;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}">
  <rect width="${VIEW_W}" height="${VIEW_H}" fill="#ffffff"/>
  ${panelEls.join("\n  ")}
  ${cutoutEls.join("\n  ")}
  ${dimEls.join("\n  ")}
</svg>`;
}

// Lazy, cached, fault-tolerant load of the resvg-js native binding.
// One attempt per cold start; subsequent calls reuse the cached result.
// The literal-string `require()` argument is what the Vercel bundler
// follows to include `@resvg/resvg-js` in the function bundle — the
// platform-specific `.node` file beneath it lands via vercel.json's
// functions.includeFiles config.
type ResvgClass = new (svg: string, options: object) => {
  render: () => { asPng: () => Buffer };
};
let _ResvgClass: ResvgClass | null = null;
let _loadAttempted = false;

function tryLoadResvg(): ResvgClass | null {
  if (_loadAttempted) return _ResvgClass;
  _loadAttempted = true;
  try {
    const requireFn = createRequire(import.meta.url);
    const mod = requireFn("@resvg/resvg-js") as { Resvg: ResvgClass };
    _ResvgClass = mod.Resvg;
  } catch (e) {
    console.error(
      "layout-image: failed to load @resvg/resvg-js native binding — " +
        "email will be sent without layout image:",
      e,
    );
    _ResvgClass = null;
  }
  return _ResvgClass;
}

/**
 * Render the layout SVG to PNG and return a base64 data URI suitable for
 * `<img src="...">` in an HTML email. Returns `null` if the native
 * binding can't be loaded OR rendering fails. Either way the caller
 * drops the image and the rest of the email proceeds unchanged.
 */
export function renderLayoutPng(panels: LayoutPanel[]): string | null {
  const ResvgClass = tryLoadResvg();
  if (!ResvgClass) return null;
  try {
    const svg = buildLayoutSvg(panels);
    const resvg = new ResvgClass(svg, {
      fitTo: { mode: "width", value: 1200 },
      background: "rgba(255,255,255,1)",
      // loadSystemFonts: true is the resvg-js default. Vercel's Linux
      // runtime has DejaVu/Liberation fonts available which renders the
      // dimension labels fine. If labels ever regress on a runtime
      // change, bundle a font via `font.fontFiles`.
    });
    const png = resvg.render().asPng();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (e) {
    console.error("renderLayoutPng: render failed:", e);
    return null;
  }
}
