import {
  DEFAULT_THICKNESS_MM,
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

export const defaultShipping = (): ShippingMode => ({ kind: "unset" });

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
 * product configuration only — never customer PII.
 */
type ShareableQuote = Omit<Quote, "customer">;

const stripForShare = (q: Quote): ShareableQuote => {
  const { customer: _omit, ...rest } = q;
  void _omit;
  return rest;
};

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

const rehydrate = (raw: LegacyQuote & { quoteNo?: string }): Quote => ({
  ...defaultQuote(),
  ...raw,
  panels: (raw.panels ?? []).map(migratePanel),
  shipping: migrateShipping(raw),
  // Customer details are NEVER rehydrated. The share form starts empty
  // every load so stray partial state ("g", a half-typed phone, etc)
  // from an earlier session or a legacy URL hash can't leak back in.
  customer: defaultQuote().customer,
  quoteNo: typeof raw.quoteNo === "string" && raw.quoteNo.trim()
    ? raw.quoteNo
    : mintQuoteNo(),
});

export const decodeQuote = (s: string): Quote | null => {
  try {
    const raw = JSON.parse(b64url.decode(s)) as LegacyQuote & { quoteNo?: string };
    if (!raw || !Array.isArray(raw.panels)) return null;
    return rehydrate(raw);
  } catch {
    return null;
  }
};

const readLocal = (): Quote | null => {
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

export const loadInitial = (): Quote => {
  if (typeof window === "undefined") return defaultQuote();
  const hash = window.location.hash.replace(/^#q=/, "");
  const fromHash = hash ? decodeQuote(hash) : null;
  if (fromHash) return fromHash;
  const fromLocal = readLocal();
  if (fromLocal) return fromLocal;
  return defaultQuote();
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
