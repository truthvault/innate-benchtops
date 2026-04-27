/**
 * Renders the customer's actual benchtop layout as a PNG, suitable for
 * inlining into an HTML email as a base64 data URI. Mirrors the geometry
 * approach SlabPreview uses on the frontend (panels in a row separated by
 * a fixed gap, scale chosen so the whole arrangement fits the canvas) but
 * stripped down to a clean outline + cutout markers for cross-client
 * email rendering. No drag, no wood texture, no live editing.
 */

import { Resvg } from "@resvg/resvg-js";

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

/**
 * Render the layout SVG to PNG and return a base64 data URI suitable for
 * <img src="..."> in an HTML email. Returns `null` if rendering fails so
 * the caller can fall back gracefully (the email still has the panels
 * table — losing the image isn't catastrophic).
 */
export function renderLayoutPng(panels: LayoutPanel[]): string | null {
  try {
    const svg = buildLayoutSvg(panels);
    const resvg = new Resvg(svg, {
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
    console.error("renderLayoutPng failed:", e);
    return null;
  }
}
