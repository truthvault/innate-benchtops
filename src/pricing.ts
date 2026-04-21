import {
  CURRENCY,
  GST_RATE,
  LOCALE,
  PRICING,
  findSpecies,
} from "./species";
import type { FinishId, SpeciesId, Thickness } from "./species";
import type { ShippingMode } from "./shipping";
import { shippingCost } from "./shipping";

export interface Cutout {
  id: string;
  /** 0..1 fraction along the panel's length axis (centre of the cutout) */
  pos: number;
  /** 0..1 fraction across the panel's width axis (centre of the cutout) */
  cross: number;
  /** cutout size along the panel length, in mm */
  widthMm: number;
  /** cutout size across the panel width, in mm */
  depthMm: number;
}

export interface Panel {
  id: string;
  label: string;
  length: number;
  width: number;
  thickness: Thickness;
  quantity: number;
  cutouts: Cutout[];
}

export interface Quote {
  panels: Panel[];
  species: SpeciesId;
  finish: FinishId;
  shipping: ShippingMode;
  customer: { name: string; email: string; phone: string; notes: string };
}

export interface PanelBreakdown {
  timber: number;
  laminating: number;
  sanding: number;
  coating: number;
  oil: number;
  cutouts: number;
  areaM2: number;
  volumeM3: number;
  weightKg: number;
  /** Cost subtotal for this panel line, ex all fees/buffer/margin/GST */
  subtotal: number;
}

export interface LineCost {
  panel: Panel;
  breakdown: PanelBreakdown;
  /** Per-unit price incl GST (display) */
  priceEach: number;
  /** Total line price incl GST × quantity */
  priceTotal: number;
}

export interface Totals {
  lines: LineCost[];
  jobSubtotalInclGst: number;
  shipping: { cost: number; label: string };
  totalExGst: number;
  gst: number;
  totalInclGst: number;
  grand: number;
  net: number;
  deliveryWeight: number;
  leadTimeWeeks: number;
}

// ─── Per-panel cost calculation ────────────────────────────────────────────

function calcPanel(p: Panel, finish: FinishId, speciesId: SpeciesId): PanelBreakdown {
  const sp = findSpecies(speciesId);
  const cfg = PRICING;
  const qty = Math.max(1, Math.floor(p.quantity) || 1);

  const L_m = p.length / 1000;
  const W_m = p.width / 1000;
  const T_m = p.thickness / 1000;

  const boardsNeeded = Math.ceil(p.width / sp.boardWidthMm);
  const rawLengthMm = (p.length + cfg.laminatorOverhangMm) * (1 + cfg.wastagePct);
  const lmEach = boardsNeeded * (rawLengthMm / 1000);
  const timberEach = lmEach * cfg.pricePerLm;

  const volEach = L_m * W_m * T_m;
  const areaEach = L_m * W_m;
  const lamMatEach = volEach * cfg.laminating.perM3;

  let sandEach = 0;
  let coatEach = 0;
  let oilEach = 0;
  if (finish === "oiled") {
    const f = cfg.finishing;
    const sandHrs = Math.max(f.minHours, areaEach * f.sandingHoursPerM2);
    const coatHrs = Math.max(f.minHours, areaEach * f.coatingHoursPerM2);
    sandEach = sandHrs * f.labourRate;
    coatEach = coatHrs * f.labourRate;
    const oilPerL = f.oilCostPer10L / 10;
    const litres = areaEach / f.oilCoverageM2PerL;
    oilEach = litres * oilPerL;
  }

  const cutoutEach = (p.cutouts ?? []).length * cfg.cutoutPrice;

  const subtotalEach =
    timberEach + lamMatEach + sandEach + coatEach + oilEach + cutoutEach;

  return {
    timber: timberEach * qty,
    laminating: lamMatEach * qty,
    sanding: sandEach * qty,
    coating: coatEach * qty,
    oil: oilEach * qty,
    cutouts: cutoutEach * qty,
    areaM2: areaEach * qty,
    volumeM3: volEach * qty,
    weightKg: volEach * sp.densityKgM3 * qty,
    subtotal: subtotalEach * qty,
  };
}

function applyMarkup(costSubtotal: number) {
  const cfg = PRICING;
  const withBuffer = costSubtotal * (1 + cfg.bufferPct);
  const ex = withBuffer * (1 + cfg.marginPct);
  const gst = ex * cfg.gstRate;
  return { ex, gst, incl: ex + gst };
}

// ─── Job-level pricing ─────────────────────────────────────────────────────

export function priceQuote(q: Quote): Totals {
  const cfg = PRICING;

  const perJobFixed =
    cfg.laminating.collectionFee +
    cfg.laminating.deliveryFee +
    cfg.perJobFixed.panelRepairFund +
    cfg.perJobFixed.admin;

  const breakdowns = q.panels.map((p) => calcPanel(p, q.finish, q.species));
  const totalUnits = q.panels.reduce(
    (sum, p) => sum + Math.max(1, Math.floor(p.quantity) || 1),
    0,
  ) || 1;
  const perUnitFixed = perJobFixed / totalUnits;

  const lines: LineCost[] = q.panels.map((p, i) => {
    const qty = Math.max(1, Math.floor(p.quantity) || 1);
    const b = breakdowns[i];
    const fixedShare = perUnitFixed * qty;
    const panelCostSubtotal = b.subtotal + fixedShare;
    const { incl } = applyMarkup(panelCostSubtotal);
    return {
      panel: p,
      breakdown: b,
      priceEach: incl / qty,
      priceTotal: incl,
    };
  });

  const jobSubtotalInclGst = lines.reduce((s, l) => s + l.priceTotal, 0);
  const jobSubtotalExGst = jobSubtotalInclGst / (1 + cfg.gstRate);

  const shipping = shippingCost(q.shipping, q.panels);

  const totalInclGst = jobSubtotalInclGst + shipping.cost;
  const totalExGst = jobSubtotalExGst + shipping.cost / (1 + cfg.gstRate);
  const gst = totalInclGst - totalExGst;
  const weight = breakdowns.reduce((s, b) => s + b.weightKg, 0);

  return {
    lines,
    jobSubtotalInclGst,
    shipping,
    totalExGst,
    gst,
    totalInclGst,
    grand: round2(totalInclGst),
    net: round2(totalExGst),
    deliveryWeight: weight,
    leadTimeWeeks: leadTimeWeeks(q),
  };
}

// ─── Lead time rules ───────────────────────────────────────────────────────

export function leadTimeWeeks(q: Quote): number {
  const cfg = PRICING.leadTimeWeeks;
  return q.finish === "raw" ? cfg.raw : cfg.other;
}

// Used in old LineCost consumers — kept for ergonomic access
export interface OldLineCost {
  area: number;
  weight: number;
  timber: number;
  cutouts: number;
  subtotal: number;
}

export function priceLine(p: Panel, speciesId: SpeciesId): OldLineCost {
  const b = calcPanel(p, "oiled", speciesId);
  const perJobFixed =
    PRICING.laminating.collectionFee +
    PRICING.laminating.deliveryFee +
    PRICING.perJobFixed.panelRepairFund +
    PRICING.perJobFixed.admin;
  const qty = Math.max(1, Math.floor(p.quantity) || 1);
  const { incl } = applyMarkup(b.subtotal + perJobFixed);
  return {
    area: b.areaM2,
    weight: b.weightKg,
    timber: b.timber,
    cutouts: b.cutouts,
    subtotal: incl / qty, // show per-unit incl-GST, aligned to new model
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export const areaM2 = (p: Panel) =>
  (p.length / 1000) * (p.width / 1000) * p.quantity;

export const weightKg = (p: Panel, densityKgM3: number) =>
  (p.length / 1000) * (p.width / 1000) * (p.thickness / 1000) *
  densityKgM3 *
  p.quantity;

export const formatNZD = (n: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(n);

export const formatNZDPrecise = (n: number) =>
  new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: CURRENCY,
  }).format(n);

// Backwards-compat re-export for consumers still using this name
export { GST_RATE };
