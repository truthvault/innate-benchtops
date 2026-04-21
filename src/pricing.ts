import {
  CURRENCY,
  CUTOUT,
  GST_RATE,
  LOCALE,
  MIN_JOB,
  RAW_DISCOUNT,
  findSpecies,
  thicknessFactor,
} from "./species";
import type {
  DeliveryId,
  FinishId,
  SpeciesId,
  Thickness,
} from "./species";

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
  delivery: DeliveryId;
  address: string;
  customer: { name: string; email: string; phone: string; notes: string };
}

export interface LineCost {
  area: number;
  weight: number;
  timber: number;
  cutouts: number;
  subtotal: number;
}

export interface Totals {
  lines: LineCost[];
  timber: number;
  cutouts: number;
  rawDiscount: number;
  work: number;
  delivery: number;
  deliveryWeight: number;
  grand: number;
  net: number;
  gst: number;
  belowMinimum: boolean;
}

export const areaM2 = (p: Panel) =>
  (p.length / 1000) * (p.width / 1000) * p.quantity;

export const weightKg = (p: Panel, densityKgM3: number) =>
  (p.length / 1000) * (p.width / 1000) * (p.thickness / 1000) *
  densityKgM3 *
  p.quantity;

export function priceLine(p: Panel, speciesId: SpeciesId): LineCost {
  const species = findSpecies(speciesId);
  const area = areaM2(p);
  const weight = weightKg(p, species.densityKgM3);
  const tf = thicknessFactor(p.thickness);
  const timber = area * species.rateNZD * tf;
  const cutouts = (p.cutouts?.length ?? 0) * CUTOUT;
  return { area, weight, timber, cutouts, subtotal: timber + cutouts };
}

export function priceQuote(q: Quote): Totals {
  const lines = q.panels.map((p) => priceLine(p, q.species));
  const timber = sum(lines.map((l) => l.timber));
  const cutouts = sum(lines.map((l) => l.cutouts));
  const weight = sum(lines.map((l) => l.weight));

  const workBeforeDiscount = timber + cutouts;
  const rawDiscount = q.finish === "raw" ? workBeforeDiscount * RAW_DISCOUNT : 0;
  const workRaw = workBeforeDiscount - rawDiscount;
  const work = workRaw > 0 && workRaw < MIN_JOB ? MIN_JOB : workRaw;

  const delivery = 0;
  const grand = round2(work + delivery);
  const net = round2(grand / (1 + GST_RATE));
  const gst = round2(grand - net);

  return {
    lines,
    timber,
    cutouts,
    rawDiscount,
    work,
    delivery,
    deliveryWeight: weight,
    grand,
    net,
    gst,
    belowMinimum: workRaw > 0 && workRaw < MIN_JOB,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

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
