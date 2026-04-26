import speciesJson from "../mock-data/species.json";
import pricingJson from "../mock-data/pricing.json";

export type SpeciesId = "rimu" | "totara" | "beech";
export type FinishId = "oiled" | "raw";
export type Thickness = number;

export interface GrainPalette {
  base: string;
  streak: string;
  mid: string;
  highlight: string;
}

export interface Species {
  id: SpeciesId;
  name: string;
  latin: string;
  origin: string;
  label: string;
  boardWidthMm: number;
  boardThicknessMm: number;
  densityKgM3: number;
  maxThicknessMm: number;
  photo: string;
  photoDims: { widthMm: number; lengthMm: number };
  grain: GrainPalette;
}

export const SPECIES: Species[] = speciesJson as Species[];

export const findSpecies = (id: SpeciesId): Species =>
  SPECIES.find((s) => s.id === id) ?? SPECIES[0];

// Product floors — no panel can go below these on any axis.
// Matches the thinnest benchtop thickness on the Innate shop (20 mm).
export const MIN_LENGTH_MM = 300;
export const MIN_WIDTH_MM = 250;
export const MIN_THICKNESS_MM = 20;
export const DEFAULT_THICKNESS_MM = 33;

// Product ceilings — bounded by what the supply chain and shipping can
// actually carry. Thickness max is per species (see species.json).
export const MAX_LENGTH_MM = 4500;
export const MAX_WIDTH_MM = 1200;
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 50;

export const PRICING = pricingJson as {
  pricePerLm: number;
  gstRate: number;
  marginPct: number;
  bufferPct: number;
  wastagePct: number;
  densityKgPerM3: number;
  laminatorOverhangMm: number;
  laminating: { perM3: number; collectionFee: number; deliveryFee: number };
  finishing: {
    labourRate: number;
    sandingHoursPerM2: number;
    coatingHoursPerM2: number;
    minHours: number;
    oilCostPer10L: number;
    oilCoverageM2PerL: number;
  };
  cutoutPrice: number;
  cutoutDefaults: { widthMm: number; depthMm: number };
  perJobFixed: { panelRepairFund: number; admin: number };
  leadTimeWeeks: { raw: number; other: number };
  currency: string;
  locale: string;
};

export const LOCALE = PRICING.locale;
export const CURRENCY = PRICING.currency;
export const GST_RATE = PRICING.gstRate;
