import { DEFAULT_THICKNESS_MM } from "./species";
import type { DeliveryId, FinishId, SpeciesId, Thickness } from "./species";
import type { Cutout, Panel, Quote } from "./pricing";

export const STORAGE_KEY = "innate.benchtop.v2";

let seq = 0;
export const newId = () => {
  seq += 1;
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
};

export const blankPanel = (label = "Benchtop"): Panel => ({
  id: newId(),
  label,
  length: 2400,
  width: 650,
  thickness: DEFAULT_THICKNESS_MM as Thickness,
  quantity: 1,
  cutouts: [],
});

export const defaultQuote = (): Quote => ({
  panels: [blankPanel("Island bench")],
  species: "rimu" as SpeciesId,
  finish: "oiled" as FinishId,
  delivery: "pickup" as DeliveryId,
  address: "",
  customer: { name: "", email: "", phone: "", notes: "" },
});

export const quoteNumber = (seed: string) => {
  const d = new Date();
  const y = d.getFullYear().toString().slice(2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const n = (h % 900) + 100;
  return `INT-${y}${m}${day}-${n}`;
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
  cutouts?: number | Cutout[];
  sinks?: number;
  cooktops?: number;
};

export const DEFAULT_CUTOUT_WIDTH_MM = 600;
export const DEFAULT_CUTOUT_DEPTH_MM = 460;

const buildCutouts = (count: number): Cutout[] => {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => ({
    id: newId(),
    pos: (i + 0.5) / count,
    cross: 0.5,
    widthMm: DEFAULT_CUTOUT_WIDTH_MM,
    depthMm: DEFAULT_CUTOUT_DEPTH_MM,
  }));
};

const migratePanel = (p: LegacyPanel): Panel => {
  let cutouts: Cutout[];
  if (Array.isArray(p.cutouts)) {
    cutouts = p.cutouts.map((c) => ({
      id: c?.id ?? newId(),
      pos: clamp01(typeof c?.pos === "number" ? c.pos : 0.5),
      cross: clamp01(typeof c?.cross === "number" ? c.cross : 0.5),
      widthMm: typeof c?.widthMm === "number" ? c.widthMm : DEFAULT_CUTOUT_WIDTH_MM,
      depthMm: typeof c?.depthMm === "number" ? c.depthMm : DEFAULT_CUTOUT_DEPTH_MM,
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

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export const decodeQuote = (s: string): Quote | null => {
  try {
    const raw = JSON.parse(b64url.decode(s));
    if (!raw || !Array.isArray(raw.panels)) return null;
    const q = raw as Partial<Quote> & { panels: LegacyPanel[] };
    return {
      ...defaultQuote(),
      ...q,
      panels: q.panels.map(migratePanel),
      customer: { ...defaultQuote().customer, ...(q.customer ?? {}) },
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
      const q = JSON.parse(raw) as Partial<Quote> & { panels?: LegacyPanel[] };
      if (q && Array.isArray(q.panels)) {
        return {
          ...defaultQuote(),
          ...q,
          panels: q.panels.map(migratePanel),
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
