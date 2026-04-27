import {
  DEFAULT_THICKNESS_MM,
  findSpecies,
  MAX_LENGTH_MM,
  MAX_QUANTITY,
  MAX_WIDTH_MM,
  MIN_LENGTH_MM,
  MIN_QUANTITY,
  MIN_THICKNESS_MM,
  MIN_WIDTH_MM,
  PRICING,
} from "./species";
import type { FinishId, SpeciesId, Thickness } from "./species";
import type { Cutout, Panel, Quote } from "./pricing";
import type { ShippingMode } from "./shipping";

// v4 bump: default shipping changed to "unset", quoteNo now persisted,
// URL hash no longer contains customer PII. Old v3 payloads still load
// via the migration in loadInitial.
export const STORAGE_KEY = "innate.benchtop.v4";
const LEGACY_STORAGE_KEYS = ["innate.benchtop.v3"];

/** A single field that the loader silently clamped during rehydrate.
 *  Surfaced through `LoadResult.adjustments` so the UI can warn the
 *  customer that the quote they see is not the one they shared. */
export type Adjustment =
  | { kind: "panel.length"; panelLabel: string; panelIndex: number; from: number; to: number; reason: string }
  | { kind: "panel.width"; panelLabel: string; panelIndex: number; from: number; to: number; reason: string }
  | { kind: "panel.thickness"; panelLabel: string; panelIndex: number; from: number; to: number; reason: string }
  | { kind: "panel.quantity"; panelLabel: string; panelIndex: number; from: number; to: number; reason: string }
  | { kind: "cutout.width"; panelLabel: string; panelIndex: number; cutoutIndex: number; from: number; to: number; reason: string }
  | { kind: "cutout.depth"; panelLabel: string; panelIndex: number; cutoutIndex: number; from: number; to: number; reason: string }
  | { kind: "cutout.position"; panelLabel: string; panelIndex: number; cutoutIndex: number; reason: string };

export interface LoadResult {
  quote: Quote;
  /** Empty when nothing was clamped. UI should show no notice in that case. */
  adjustments: Adjustment[];
}

/** Minimum spec for at least one panel in a shareable quote. Mirrors the
 *  customer-facing rule shown in the panel-editor footer hint. Width and
 *  thickness floors are already enforced by the per-field input bounds in
 *  PanelEditor, so in practice the binding constraint is `lengthMm`. */
export const MAIN_PANEL_MIN = {
  lengthMm: 1200,
  widthMm: 250,
  thicknessMm: 20,
} as const;

/**
 * A quote is shareable only when at least one of its panels meets the
 * full main-benchtop spec. Quantity is irrelevant — a single bench-sized
 * panel with qty 1 still satisfies the rule. Sub-spec offcuts and shelves
 * may sit alongside but never on their own.
 */
export const quoteHasMainPanel = (q: Quote): boolean =>
  q.panels.some(
    (p) =>
      p.length >= MAIN_PANEL_MIN.lengthMm &&
      p.width >= MAIN_PANEL_MIN.widthMm &&
      p.thickness >= MAIN_PANEL_MIN.thicknessMm,
  );

let seq = 0;
export const newId = () => {
  seq += 1;
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
};

export const defaultCutoutDims = () => ({
  widthMm: PRICING.cutoutDefaults.widthMm,
  depthMm: PRICING.cutoutDefaults.depthMm,
});

/** Floor for cutout width/depth — anything narrower is below the joinery
 *  tolerance for sinks and cooktops. */
export const MIN_CUTOUT_MM = 50;

/**
 * Shrink + re-centre a cutout so it still fits inside the given panel
 * dimensions. Cutouts never grow here — only clamp down. Edges may sit
 * flush with panel edges; the per-cutout floor is MIN_CUTOUT_MM.
 *
 * Used when the panel resizes via drag or NumField, when a new cutout is
 * added to a panel smaller than the default cutout size, and at load time
 * to defensively normalise stale URL-hash data.
 */
export const clampCutoutToPanel = (
  c: Cutout,
  panelLen: number,
  panelWid: number,
): Cutout => {
  const maxW = Math.max(MIN_CUTOUT_MM, panelLen);
  const maxD = Math.max(MIN_CUTOUT_MM, panelWid);
  const widthMm = Math.max(MIN_CUTOUT_MM, Math.min(c.widthMm, maxW));
  const depthMm = Math.max(MIN_CUTOUT_MM, Math.min(c.depthMm, maxD));
  const halfAlong = widthMm / 2 / panelLen;
  const halfAcross = depthMm / 2 / panelWid;
  const pos = Math.max(halfAlong, Math.min(1 - halfAlong, c.pos));
  const cross = Math.max(halfAcross, Math.min(1 - halfAcross, c.cross));
  return { ...c, widthMm, depthMm, pos, cross };
};

/**
 * Normalise a panel so its cutouts always fit within its current dimensions.
 * Non-cutout fields pass through unchanged.
 */
export const normalizePanel = (p: Panel): Panel => ({
  ...p,
  cutouts: p.cutouts.map((c) => clampCutoutToPanel(c, p.length, p.width)),
});

// ─── Cutout overlap prevention ────────────────────────────────────────────

interface CutoutBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const cutoutBounds = (
  c: Cutout,
  panelLen: number,
  panelWid: number,
): CutoutBounds => {
  const cx = c.pos * panelLen;
  const cy = c.cross * panelWid;
  return {
    xMin: cx - c.widthMm / 2,
    xMax: cx + c.widthMm / 2,
    yMin: cy - c.depthMm / 2,
    yMax: cy + c.depthMm / 2,
  };
};

/** Strict overlap — cutouts can touch edge-to-edge without overlapping. */
export const cutoutsOverlap = (
  a: Cutout,
  b: Cutout,
  panelLen: number,
  panelWid: number,
): boolean => {
  const ab = cutoutBounds(a, panelLen, panelWid);
  const bb = cutoutBounds(b, panelLen, panelWid);
  return (
    ab.xMin < bb.xMax && ab.xMax > bb.xMin &&
    ab.yMin < bb.yMax && ab.yMax > bb.yMin
  );
};

const overlapsAny = (
  c: Cutout,
  others: Cutout[],
  panelLen: number,
  panelWid: number,
): boolean =>
  others.some((o) => cutoutsOverlap(c, o, panelLen, panelWid));

const maxWidthForCutout = (
  c: Cutout,
  others: Cutout[],
  panelLen: number,
  panelWid: number,
): number => {
  const cx = c.pos * panelLen;
  const cy = c.cross * panelWid;
  const yMin = cy - c.depthMm / 2;
  const yMax = cy + c.depthMm / 2;
  let maxW = Math.max(50, panelLen - 20);
  for (const o of others) {
    const ob = cutoutBounds(o, panelLen, panelWid);
    // Only constrains widthMm when the Y-intervals would overlap.
    if (yMax > ob.yMin && yMin < ob.yMax) {
      if (cx <= ob.xMin) {
        maxW = Math.min(maxW, 2 * (ob.xMin - cx));
      } else if (cx >= ob.xMax) {
        maxW = Math.min(maxW, 2 * (cx - ob.xMax));
      } else {
        // Cutout centre is inside the other's X-range → no non-zero widthMm can avoid overlap.
        maxW = 0;
      }
    }
  }
  return Math.max(50, maxW);
};

const maxDepthForCutout = (
  c: Cutout,
  others: Cutout[],
  panelLen: number,
  panelWid: number,
): number => {
  const cx = c.pos * panelLen;
  const cy = c.cross * panelWid;
  const xMin = cx - c.widthMm / 2;
  const xMax = cx + c.widthMm / 2;
  let maxD = Math.max(50, panelWid - 20);
  for (const o of others) {
    const ob = cutoutBounds(o, panelLen, panelWid);
    if (xMax > ob.xMin && xMin < ob.xMax) {
      if (cy <= ob.yMin) {
        maxD = Math.min(maxD, 2 * (ob.yMin - cy));
      } else if (cy >= ob.yMax) {
        maxD = Math.min(maxD, 2 * (cy - ob.yMax));
      } else {
        maxD = 0;
      }
    }
  }
  return Math.max(50, maxD);
};

const slideCutoutToValid = (
  target: Cutout,
  current: Cutout,
  others: Cutout[],
  panelLen: number,
  panelWid: number,
): Cutout => {
  if (!overlapsAny(target, others, panelLen, panelWid)) return target;

  // Try moving along only one axis — lets the cutout slide along a wall
  // when the user drags diagonally into a blocker.
  const xOnly = clampCutoutToPanel({ ...target, cross: current.cross }, panelLen, panelWid);
  const yOnly = clampCutoutToPanel({ ...target, pos: current.pos }, panelLen, panelWid);
  const xValid = !overlapsAny(xOnly, others, panelLen, panelWid);
  const yValid = !overlapsAny(yOnly, others, panelLen, panelWid);
  if (xValid && yValid) {
    const dx = Math.abs(target.pos - current.pos);
    const dy = Math.abs(target.cross - current.cross);
    return dx >= dy ? xOnly : yOnly;
  }
  if (xValid) return xOnly;
  if (yValid) return yOnly;

  // Both axes are blocked together — bisect from current toward target,
  // returning the furthest valid step along the path.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const candidate = clampCutoutToPanel({
      ...target,
      pos: current.pos + (target.pos - current.pos) * mid,
      cross: current.cross + (target.cross - current.cross) * mid,
    }, panelLen, panelWid);
    if (overlapsAny(candidate, others, panelLen, panelWid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return clampCutoutToPanel({
    ...target,
    pos: current.pos + (target.pos - current.pos) * lo,
    cross: current.cross + (target.cross - current.cross) * lo,
  }, panelLen, panelWid);
};

/**
 * Constrain a proposed cutout change so it doesn't overlap siblings and
 * stays inside the panel. Panel-edge clamping is applied too.
 *
 * - If size grew enough to cause overlap, shrink size to the max that fits.
 * - If position change would cause overlap, slide along the nearest valid
 *   path; fall back to `current` if everything is blocked.
 */
export const constrainCutout = (
  proposed: Cutout,
  current: Cutout,
  others: Cutout[],
  panelLen: number,
  panelWid: number,
): Cutout => {
  let result = clampCutoutToPanel(proposed, panelLen, panelWid);
  if (others.length === 0) return result;

  // Clamp size first so the overlap check after has the intended size.
  if (result.widthMm > current.widthMm) {
    const maxW = maxWidthForCutout(
      { ...result, depthMm: current.depthMm },
      others, panelLen, panelWid,
    );
    if (result.widthMm > maxW) {
      result = clampCutoutToPanel({ ...result, widthMm: maxW }, panelLen, panelWid);
    }
  }
  if (result.depthMm > current.depthMm) {
    const maxD = maxDepthForCutout(
      { ...result, widthMm: current.widthMm },
      others, panelLen, panelWid,
    );
    if (result.depthMm > maxD) {
      result = clampCutoutToPanel({ ...result, depthMm: maxD }, panelLen, panelWid);
    }
  }

  if (overlapsAny(result, others, panelLen, panelWid)) {
    result = slideCutoutToValid(result, current, others, panelLen, panelWid);
  }
  return result;
};

export const DEFAULT_CUTOUT_WIDTH_MM = PRICING.cutoutDefaults.widthMm;
export const DEFAULT_CUTOUT_DEPTH_MM = PRICING.cutoutDefaults.depthMm;

export const blankPanel = (label = ""): Panel => ({
  id: newId(),
  label,
  length: 1500,
  width: 450,
  thickness: DEFAULT_THICKNESS_MM as Thickness,
  quantity: 1,
  cutouts: [],
});

// Default to "delivering" (Deliver to me, no address yet) so the first
// thing a customer sees on the sticky bar is a clear prompt to enter
// their address. They can still switch to Pick up at any time.
export const defaultShipping = (): ShippingMode => ({ kind: "delivering" });

export const quoteNumber = (seed: string) => {
  const base = 648;
  const anchor = Date.UTC(2026, 3, 21); // 2026-04-21 — baseline for drift
  const daysSince = Math.max(
    0,
    Math.floor((Date.now() - anchor) / 86_400_000),
  );
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const noise = h % 5;
  const n = base + daysSince * 3 + noise;
  return `INT-${n}`;
};

export const mintQuoteNo = () => {
  const seed = Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  return quoteNumber(seed);
};

export const defaultQuote = (): Quote => ({
  panels: [blankPanel("")],
  species: "rimu" as SpeciesId,
  finish: "oiled" as FinishId,
  shipping: defaultShipping(),
  customer: { name: "", email: "", phone: "", notes: "" },
  quoteNo: mintQuoteNo(),
});

const b64url = {
  encode(s: string) {
    return btoa(unescape(encodeURIComponent(s)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  },
  decode(s: string) {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "====".slice(b64.length % 4);
    return decodeURIComponent(escape(atob(b64 + pad)));
  },
};

/**
 * Shape that's safe to put in a URL or copy-paste share. Contains the
 * product configuration only — never customer PII, never any legacy field.
 */
type ShareableQuote = Omit<Quote, "customer">;

// Built field-by-field rather than via spread-rest so any non-canonical
// runtime property (legacy `delivery` / `address`, future schema drift)
// is dropped at the persist boundary instead of silently round-tripping.
const stripForShare = (q: Quote): ShareableQuote => ({
  panels: q.panels,
  species: q.species,
  finish: q.finish,
  shipping: q.shipping,
  quoteNo: q.quoteNo,
});

/** URL-safe: excludes customer details. Use this for the hash + share links. */
export const encodeQuoteForShare = (q: Quote) =>
  b64url.encode(JSON.stringify(stripForShare(q)));

type LegacyPanel = Omit<Partial<Panel>, "cutouts"> & {
  cutouts?: number | Array<Partial<Cutout>>;
  sinks?: number;
  cooktops?: number;
};

type LegacyQuote = Partial<Omit<Quote, "panels">> & {
  panels?: LegacyPanel[];
  // older prototypes stored these two fields
  delivery?: string;
  address?: string;
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

const buildCutouts = (count: number): Cutout[] => {
  if (count <= 0) return [];
  const d = defaultCutoutDims();
  return Array.from({ length: count }, (_, i) => ({
    id: newId(),
    pos: (i + 0.5) / count,
    cross: 0.5,
    widthMm: d.widthMm,
    depthMm: d.depthMm,
  }));
};

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

const migratePanel = (
  p: LegacyPanel,
  panelIndex: number,
): { panel: Panel; adjustments: Adjustment[] } => {
  const adj: Adjustment[] = [];
  const label = p.label ?? "";

  // Build cutouts from whichever legacy shape the input uses. Raw values
  // are kept here unchanged so the panel-bounds clamp below can detect
  // what came in vs what survived.
  let cutouts: Cutout[];
  if (Array.isArray(p.cutouts)) {
    const d = defaultCutoutDims();
    cutouts = p.cutouts.map((c) => ({
      id: c?.id ?? newId(),
      pos: clamp01(typeof c?.pos === "number" ? c.pos : 0.5),
      cross: clamp01(typeof c?.cross === "number" ? c.cross : 0.5),
      widthMm: typeof c?.widthMm === "number" ? c.widthMm : d.widthMm,
      depthMm: typeof c?.depthMm === "number" ? c.depthMm : d.depthMm,
    }));
  } else if (typeof p.cutouts === "number") {
    cutouts = buildCutouts(p.cutouts);
  } else {
    cutouts = buildCutouts((p.sinks ?? 0) + (p.cooktops ?? 0));
  }
  const rawCutouts = Array.isArray(p.cutouts) ? p.cutouts : null;

  // Defensively clamp each dimension to product bounds so a legacy or
  // hand-crafted shared URL with absurd values (length=50000, qty=999)
  // can't rehydrate into an invalid editor state. Thickness gets a min
  // floor here; the species-aware max cap is applied in rehydrate, where
  // we know which species the quote uses.
  const length = clampRange(p.length ?? 2400, MIN_LENGTH_MM, MAX_LENGTH_MM);
  const width = clampRange(p.width ?? 650, MIN_WIDTH_MM, MAX_WIDTH_MM);

  if (isFiniteNumber(p.length) && p.length !== length) {
    adj.push({
      kind: "panel.length", panelLabel: label, panelIndex,
      from: p.length, to: length,
      reason: p.length > MAX_LENGTH_MM
        ? `Max length is ${MAX_LENGTH_MM} mm`
        : `Min length is ${MIN_LENGTH_MM} mm`,
    });
  }
  if (isFiniteNumber(p.width) && p.width !== width) {
    adj.push({
      kind: "panel.width", panelLabel: label, panelIndex,
      from: p.width, to: width,
      reason: p.width > MAX_WIDTH_MM
        ? `Max width is ${MAX_WIDTH_MM} mm`
        : `Min width is ${MIN_WIDTH_MM} mm`,
    });
  }

  // Thickness — only the min floor here. Species-cap clamp + adjustment
  // is reported by rehydrate, which knows the species.
  const thickness = Math.max(
    MIN_THICKNESS_MM,
    p.thickness ?? DEFAULT_THICKNESS_MM,
  ) as Thickness;
  if (isFiniteNumber(p.thickness) && p.thickness < MIN_THICKNESS_MM) {
    adj.push({
      kind: "panel.thickness", panelLabel: label, panelIndex,
      from: p.thickness, to: thickness,
      reason: `Min thickness is ${MIN_THICKNESS_MM} mm`,
    });
  }

  // Quantity. Treat 0/NaN/undefined as "use default 1" silently — only
  // report when the user supplied a valid positive integer that needed
  // clamping.
  const intendedQty = isFiniteNumber(p.quantity) ? Math.floor(p.quantity) : null;
  const quantity = clampRange(intendedQty && intendedQty > 0 ? intendedQty : 1, MIN_QUANTITY, MAX_QUANTITY);
  if (intendedQty !== null && intendedQty > 0 && intendedQty !== quantity) {
    adj.push({
      kind: "panel.quantity", panelLabel: label, panelIndex,
      from: intendedQty, to: quantity,
      reason: intendedQty > MAX_QUANTITY
        ? `Max quantity is ${MAX_QUANTITY}`
        : `Min quantity is ${MIN_QUANTITY}`,
    });
  }

  // Cutouts are clamped against the clamped panel dims so a hash like
  // {widthMm:99999, pos:0.5} can't leak into the editor as an over-large
  // cutout that breaks the SVG preview.
  const safeCutouts = cutouts.map((c, idx) => {
    const clamped = clampCutoutToPanel(c, length, width);
    const raw = rawCutouts?.[idx];
    if (raw && isFiniteNumber(raw.widthMm) && raw.widthMm !== clamped.widthMm) {
      adj.push({
        kind: "cutout.width", panelLabel: label, panelIndex, cutoutIndex: idx,
        from: raw.widthMm, to: clamped.widthMm,
        reason: raw.widthMm > length
          ? `Max cutout width is ${length} mm (panel length)`
          : `Min cutout width is ${MIN_CUTOUT_MM} mm`,
      });
    }
    if (raw && isFiniteNumber(raw.depthMm) && raw.depthMm !== clamped.depthMm) {
      adj.push({
        kind: "cutout.depth", panelLabel: label, panelIndex, cutoutIndex: idx,
        from: raw.depthMm, to: clamped.depthMm,
        reason: raw.depthMm > width
          ? `Max cutout depth is ${width} mm (panel width)`
          : `Min cutout depth is ${MIN_CUTOUT_MM} mm`,
      });
    }
    // Position adjustment fires when a user-supplied pos/cross had to be
    // moved to keep the cutout inside the panel. We compare against the
    // raw value (not clamp01-normalized) so a hash with pos=1.5 still
    // triggers the notice.
    const posMoved = raw && isFiniteNumber(raw.pos) && raw.pos !== clamped.pos;
    const crossMoved = raw && isFiniteNumber(raw.cross) && raw.cross !== clamped.cross;
    if (posMoved || crossMoved) {
      adj.push({
        kind: "cutout.position", panelLabel: label, panelIndex, cutoutIndex: idx,
        reason: "Cutout was outside the panel — moved inside",
      });
    }
    return clamped;
  });

  return {
    panel: {
      id: p.id ?? newId(),
      label,
      length,
      width,
      thickness,
      quantity,
      cutouts: safeCutouts,
    },
    adjustments: adj,
  };
};

const clampRange = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

const migrateShipping = (raw: LegacyQuote): ShippingMode => {
  if (raw.shipping && typeof raw.shipping === "object" && "kind" in raw.shipping) {
    return raw.shipping as ShippingMode;
  }
  // Backwards-compat: pre-structured-shipping prototypes stored
  // `delivery: "pickup"` and a free-text `address`. Honour pickup only —
  // for other legacy values (`"nationwide"`) we have no destination to
  // map and the default delivering-mode prompt is more honest than
  // guessing pickup.
  if (raw.delivery === "pickup") return { kind: "pickup" };
  return defaultShipping();
};

const rehydrate = (raw: LegacyQuote & { quoteNo?: string }): LoadResult => {
  const species = (raw.species ?? defaultQuote().species) as SpeciesId;
  const speciesObj = findSpecies(species);
  const maxThickness = speciesObj.maxThicknessMm;

  const adjustments: Adjustment[] = [];
  const rawPanels = raw.panels ?? [];
  const panels = rawPanels.map((rp, idx) => {
    const { panel, adjustments: panelAdj } = migratePanel(rp, idx);
    adjustments.push(...panelAdj);

    // Species-aware thickness cap. The from-value is the user-supplied
    // raw thickness so the customer sees what they shared, not what
    // migratePanel's min-floor pass intermediate-clamped to.
    const finalThickness = Math.min(panel.thickness, maxThickness) as Thickness;
    if (isFiniteNumber(rp.thickness) && rp.thickness > maxThickness) {
      adjustments.push({
        kind: "panel.thickness",
        panelLabel: panel.label,
        panelIndex: idx,
        from: rp.thickness,
        to: finalThickness,
        reason: `Max thickness for ${speciesObj.name} is ${maxThickness} mm`,
      });
    }
    return { ...panel, thickness: finalThickness };
  });

  // Built field-by-field — no `...raw` spread — so legacy / unknown
  // properties on the input (e.g. the old `delivery` / `address` keys
  // that pre-dated the structured `shipping` field) can't leak onto the
  // Quote and round-trip back into localStorage / the URL hash.
  const finish: FinishId = (raw.finish ?? defaultQuote().finish) as FinishId;
  const quote: Quote = {
    panels,
    species,
    finish,
    shipping: migrateShipping(raw),
    // Customer details are NEVER rehydrated. The share form starts empty
    // every load so stray partial state ("g", a half-typed phone, etc)
    // from an earlier session or a legacy URL hash can't leak back in.
    customer: defaultQuote().customer,
    quoteNo: typeof raw.quoteNo === "string" && raw.quoteNo.trim()
      ? raw.quoteNo
      : mintQuoteNo(),
  };

  return { quote, adjustments };
};

export const decodeQuote = (s: string): LoadResult | null => {
  try {
    const raw = JSON.parse(b64url.decode(s)) as LegacyQuote & { quoteNo?: string };
    if (!raw || !Array.isArray(raw.panels)) return null;
    return rehydrate(raw);
  } catch {
    return null;
  }
};

const readLocal = (): LoadResult | null => {
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as LegacyQuote & { quoteNo?: string };
      if (!parsed || !Array.isArray(parsed.panels)) continue;
      return rehydrate(parsed);
    } catch {
      // try next key
    }
  }
  return null;
};

export const loadInitial = (): LoadResult => {
  if (typeof window === "undefined") return { quote: defaultQuote(), adjustments: [] };
  const hash = window.location.hash.replace(/^#q=/, "");
  const fromHash = hash ? decodeQuote(hash) : null;
  if (fromHash) return fromHash;
  const fromLocal = readLocal();
  if (fromLocal) return fromLocal;
  return { quote: defaultQuote(), adjustments: [] };
};

export const persist = (q: Quote) => {
  // Product config goes to localStorage too — customer fields are
  // stripped so reloads never repopulate the contact form with stale
  // partial data. If we ever want "remember me", it should be an
  // explicit opt-in under a separate key, not a silent side-effect.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripForShare(q)));
  } catch {
    // ignore quota / private-mode errors
  }
  // URL hash: config only. Customer fields NEVER land here.
  const encoded = encodeQuoteForShare(q);
  const url = new URL(window.location.href);
  url.hash = `q=${encoded}`;
  window.history.replaceState(null, "", url);
};

export const clearPersisted = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    for (const k of LEGACY_STORAGE_KEYS) localStorage.removeItem(k);
  } catch {
    // ignore
  }
};
