import speciesJson from "../mock-data/species.json";
import deliveryJson from "../mock-data/delivery.json";
import pricingJson from "../mock-data/pricing.json";

export type SpeciesId = "rimu" | "totara" | "beech";
export type FinishId = "oiled" | "raw";
export type DeliveryId = "pickup" | "nationwide";
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
  rateNZD: number;
  densityKgM3: number;
  maxThicknessMm: number;
  photo: string;
  grain: GrainPalette;
}

export const SPECIES: Species[] = speciesJson as Species[];

export const findSpecies = (id: SpeciesId): Species =>
  SPECIES.find((s) => s.id === id) ?? SPECIES[0];

export interface DeliveryOption {
  id: DeliveryId;
  label: string;
  detail: string;
  price: number;
}

export const DELIVERY: DeliveryOption[] = deliveryJson as DeliveryOption[];

export const findDelivery = (id: DeliveryId): DeliveryOption =>
  DELIVERY.find((d) => d.id === id) ?? DELIVERY[0];

export const MIN_THICKNESS_MM = 12;
export const DEFAULT_THICKNESS_MM = 33;

// Piecewise-linear labour/material factor anchored to the original
// workshop breakpoints (27, 40, 50 mm). Extrapolates smoothly outside
// that range so free-typed values from 12 mm up price sensibly.
export function thicknessFactor(t: number): number {
  if (t <= 27) return Math.max(0.2, 0.8 - (27 - t) * (0.2 / 13));
  if (t <= 40) return 0.8 + (t - 27) * (0.2 / 13);
  if (t <= 50) return 1.0 + (t - 40) * (0.22 / 10);
  return 1.22 + (t - 50) * (0.022);
}

export const CUTOUT = pricingJson.cutout;
export const RAW_DISCOUNT = pricingJson.rawDiscount;
export const GST_RATE = pricingJson.gstRate;
export const MIN_JOB = pricingJson.minJob;
export const LEAD_TIME_WEEKS = pricingJson.leadTimeWeeks;
export const LOCALE = pricingJson.locale;
export const CURRENCY = pricingJson.currency;
