import {
  DEFAULT_THICKNESS_MM,
  PRICING,
} from "./species";
import type { FinishId, SpeciesId, Thickness } from "./species";
import type { Cutout, Panel, Quote } from "./pricing";
import type { ShippingMode } from "./shipping";

export const STORAGE_KEY = "innate.benchtop.v3";

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

export const DEFAULT_CUTOUT_WIDTH_MM = PRICING.cutoutDefaults.widthMm;
export const DEFAULT_CUTOUT_DEPTH_MM = PRICING.cutoutDefaults.depthMm;

export const blankPanel = (label = "Benchtop"): Panel => ({
  id: newId(),
  label,
  length: 2400,
  width: 650,
  thickness: DEFAULT_THICKNESS_MM as Thickness,
  quantity: 1,
  cutouts: [],
});

export const defaultShipping = (): ShippingMode => ({ kind: "pickup" });

export const defaultQuote = (): Quote => ({
  panels: [blankPanel("Island bench")],
  species: "rimu" as SpeciesId,
  finish: "oiled" as FinishId,
  shipping: defaultShipping(),
  customer: { name: "", email: "", phone: "", notes: "" },
});

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

export const encodeQuote = (q: Quote) => b64url.encode(JSON.stringify(q));

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

const migratePanel = (p: LegacyPanel): Panel => {
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
  return {
    id: p.id ?? newId(),
    label: p.label ?? "",
    length: p.length ?? 2400,
    width: p.width ?? 650,
    thickness: (p.thickness ?? DEFAULT_THICKNESS_MM) as Thickness,
    quantity: p.quantity ?? 1,
    cutouts,
  };
};

const migrateShipping = (raw: LegacyQuote): ShippingMode => {
  if (raw.shipping && typeof raw.shipping === "object" && "kind" in raw.shipping) {
    return raw.shipping as ShippingMode;
  }
  const legacy = raw.delivery;
  if (legacy === "pickup") return { kind: "pickup" };
  if (legacy === "nationwide") {
    // Can't infer destination from free-text address without a match; default to pickup.
    return { kind: "pickup" };
  }
  return defaultShipping();
};

export const decodeQuote = (s: string): Quote | null => {
  try {
    const raw = JSON.parse(b64url.decode(s)) as LegacyQuote;
    if (!raw || !Array.isArray(raw.panels)) return null;
    return {
      ...defaultQuote(),
      ...raw,
      panels: raw.panels.map(migratePanel),
      shipping: migrateShipping(raw),
      customer: { ...defaultQuote().customer, ...(raw.customer ?? {}) },
    } as Quote;
  } catch {
    return null;
  }
};

export const loadInitial = (): Quote => {
  if (typeof window === "undefined") return defaultQuote();
  const hash = window.location.hash.replace(/^#q=/, "");
  if (hash) {
    const q = decodeQuote(hash);
    if (q) return q;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const q = JSON.parse(raw) as LegacyQuote;
      if (q && Array.isArray(q.panels)) {
        return {
          ...defaultQuote(),
          ...q,
          panels: q.panels.map(migratePanel),
          shipping: migrateShipping(q),
          customer: { ...defaultQuote().customer, ...(q.customer ?? {}) },
        } as Quote;
      }
    }
  } catch {
    // ignore
  }
  return defaultQuote();
};

export const persist = (q: Quote) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  } catch {
    // ignore
  }
  const encoded = encodeQuote(q);
  const url = new URL(window.location.href);
  url.hash = `q=${encoded}`;
  window.history.replaceState(null, "", url);
};
