import shippingJson from "../mock-data/shipping.json";
import type { Panel } from "./pricing";
import { PRICING } from "./species";

type IslandCode = "N" | "S";
type GroupCode = "urban" | "rural";

interface Destination {
  small: number;
  large: number;
  island: IslandCode;
  group: GroupCode;
  lat: number;
  lng: number;
}

export const SHIPPING = shippingJson as {
  chchMetroFlat: number;
  chchSurroundsFlat: number;
  upliftFactor: number;
  /**
   * Single global uplift applied to every non-zero freight cost at the
   * shippingCost() boundary, on top of the existing per-destination
   * `upliftFactor`. Lets us harden quotes across the board by nudging
   * one number without touching destination anchors or rounding.
   */
  globalFreightMultiplier: number;
  refSmallKg: number;
  refLargeKg: number;
  /**
   * Past refLargeKg the freight curve steepens: slope becomes
   * baseSlope × heavySlopeMultiplier, and a flat heavyHandlingFee is
   * added. Reflects the carrier step-change from parcel to pallet /
   * truck freight for heavy jobs.
   */
  heavySlopeMultiplier: number;
  heavyHandlingFee: number;
  /**
   * Any panel longer than overlengthThresholdMm triggers a one-off
   * overlengthSurcharge on the job. NZ carriers typically charge this
   * for items beyond ~2.8 m.
   */
  overlengthThresholdMm: number;
  overlengthSurcharge: number;
  /**
   * Rural-grouped destinations carry an extra multiplier on top of
   * their per-destination anchors, stacked before upliftFactor.
   */
  ruralSurcharge: number;
  basePackagingKg: number;
  perPanelCratingKg: number;
  workshop: { lat: number; lng: number };
  metroPostcodes: string[];
  surroundsPostcodes: string[];
  metroSuburbs: string[];
  surroundsSuburbs: string[];
  destinations: Record<string, Destination>;
};

const METRO_POSTCODES = new Set(SHIPPING.metroPostcodes);
const SURROUNDS_POSTCODES = new Set(SHIPPING.surroundsPostcodes);

export type ShippingMode =
  | { kind: "unset" }
  /** User clicked "Deliver to me" but hasn't resolved an address yet. */
  | { kind: "delivering" }
  | { kind: "pickup" }
  | { kind: "chchMetro" }
  | { kind: "chchSurrounds" }
  | { kind: "nationwide"; destination: string }
  | { kind: "other" };

export interface AddressMatch {
  mode: ShippingMode;
  label: string;
  priceLabel: string;
  confidence: "high" | "low";
}

export interface DestinationGroup {
  label: string;
  destinations: string[];
}

export const DESTINATIONS_GROUPED: DestinationGroup[] = (() => {
  const entries = Object.entries(SHIPPING.destinations) as [string, Destination][];
  const pick = (island: IslandCode, group: GroupCode) =>
    entries
      .filter(([, d]) => d.island === island && d.group === group)
      .map(([name]) => name)
      .sort();
  return [
    { label: "North Island — urban centres", destinations: pick("N", "urban") },
    { label: "North Island — rural & smaller towns", destinations: pick("N", "rural") },
    { label: "South Island — urban centres", destinations: pick("S", "urban") },
    { label: "South Island — rural & smaller towns", destinations: pick("S", "rural") },
  ];
})();

// Chargeable weight for a multi-panel job.
export function jobWeightKg(panels: Panel[]): number {
  const densityKgPerM3 = PRICING.densityKgPerM3;
  const totalVolumeM3 = panels.reduce((sum, p) => {
    const qty = Math.max(1, p.quantity);
    const v = (p.length / 1000) * (p.width / 1000) * (p.thickness / 1000);
    return sum + v * qty;
  }, 0);
  const totalUnits = panels.reduce(
    (n, p) => n + Math.max(1, p.quantity),
    0,
  );
  return (
    totalVolumeM3 * densityKgPerM3 +
    SHIPPING.basePackagingKg +
    SHIPPING.perPanelCratingKg * totalUnits
  );
}

function nationwideForDestination(
  destination: string,
  kg: number,
  panels: Panel[],
): number {
  const d = SHIPPING.destinations[destination];
  if (!d) return 0;
  const { refSmallKg: s, refLargeKg: l } = SHIPPING;
  const baseSlope = (d.large - d.small) / (l - s);

  // Base weight curve: linear between the small and large anchors; past
  // the large anchor the slope steepens (heavySlopeMultiplier) and a
  // flat pallet-handling fee is added to reflect the carrier jump from
  // parcel to pallet freight.
  let raw: number;
  if (kg <= s) {
    raw = d.small;
  } else if (kg <= l) {
    raw = d.small + (kg - s) * baseSlope;
  } else {
    const excess = kg - l;
    raw = d.large + excess * baseSlope * SHIPPING.heavySlopeMultiplier;
    raw += SHIPPING.heavyHandlingFee;
  }

  // Any panel longer than the threshold is an overlength item for NZ
  // carriers and attracts a one-off surcharge on the job.
  if (panels.some((p) => p.length > SHIPPING.overlengthThresholdMm)) {
    raw += SHIPPING.overlengthSurcharge;
  }

  // Rural destinations carry a freight premium on top of their anchors.
  if (d.group === "rural") raw *= SHIPPING.ruralSurcharge;

  const uplifted = raw * SHIPPING.upliftFactor;
  return Math.ceil(uplifted / 5) * 5;
}

// ─── Text matching ─────────────────────────────────────────────────────────

function matchesWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

function capitalise(s: string): string {
  return s.replace(/\b(\w)(\w*)/g, (_, a: string, b: string) => a.toUpperCase() + b);
}

export function matchAddress(text: string): AddressMatch | null {
  const lower = (text || "").toLowerCase().trim();
  if (lower.length < 3) return null;

  const postcodeMatch = lower.match(/\b(\d{4})\b/);
  const postcode = postcodeMatch?.[1];

  if (postcode) {
    if (METRO_POSTCODES.has(postcode)) {
      return {
        mode: { kind: "chchMetro" },
        label: `Christchurch Metro (${postcode})`,
        priceLabel: `$${SHIPPING.chchMetroFlat}`,
        confidence: "high",
      };
    }
    if (SURROUNDS_POSTCODES.has(postcode)) {
      return {
        mode: { kind: "chchSurrounds" },
        label: `Christchurch surrounds (${postcode})`,
        priceLabel: `$${SHIPPING.chchSurroundsFlat}`,
        confidence: "high",
      };
    }
  }

  // Surrounds suburbs first so Lyttelton/Sumner aren't misread as generic Christchurch
  for (const sub of SHIPPING.surroundsSuburbs) {
    if (matchesWord(lower, sub)) {
      return {
        mode: { kind: "chchSurrounds" },
        label: `${capitalise(sub)} (Christchurch surrounds)`,
        priceLabel: `$${SHIPPING.chchSurroundsFlat}`,
        confidence: "high",
      };
    }
  }
  for (const sub of SHIPPING.metroSuburbs) {
    if (matchesWord(lower, sub)) {
      return {
        mode: { kind: "chchMetro" },
        label: `${capitalise(sub)} (Christchurch Metro)`,
        priceLabel: `$${SHIPPING.chchMetroFlat}`,
        confidence: "high",
      };
    }
  }

  for (const dest of Object.keys(SHIPPING.destinations)) {
    if (matchesWord(lower, dest.toLowerCase())) {
      return {
        mode: { kind: "nationwide", destination: dest },
        label: `${dest} — nationwide`,
        priceLabel: "Weight-based",
        confidence: "high",
      };
    }
  }

  if (matchesWord(lower, "christchurch") || matchesWord(lower, "chch")) {
    return {
      mode: { kind: "chchMetro" },
      label: "Christchurch (Metro assumed)",
      priceLabel: `$${SHIPPING.chchMetroFlat}`,
      confidence: "low",
    };
  }

  return null;
}

// ─── Geolocation helper ────────────────────────────────────────────────────

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LocationResolution {
  mode: ShippingMode;
  label: string;
  confidence: "high" | "low";
}

/** Resolve a browser geolocation lat/lng to a shipping mode. */
export function resolveLocation(coords: { lat: number; lng: number }): LocationResolution {
  const distanceFromWorkshop = haversineKm(SHIPPING.workshop, coords);

  if (distanceFromWorkshop < 40) {
    return {
      mode: { kind: "chchMetro" },
      label: "Christchurch Metro (from your location)",
      confidence: "high",
    };
  }
  if (distanceFromWorkshop < 150) {
    return {
      mode: { kind: "chchSurrounds" },
      label: "Christchurch surrounds (from your location)",
      confidence: "high",
    };
  }

  // Further afield — pick the closest named destination
  let closest: { name: string; km: number } | null = null;
  for (const [name, dest] of Object.entries(SHIPPING.destinations)) {
    const km = haversineKm({ lat: dest.lat, lng: dest.lng }, coords);
    if (!closest || km < closest.km) closest = { name, km };
  }
  if (closest) {
    return {
      mode: { kind: "nationwide", destination: closest.name },
      label: `Nearest destination: ${closest.name}`,
      confidence: "high",
    };
  }
  return {
    mode: { kind: "pickup" },
    label: "Location unavailable",
    confidence: "low",
  };
}

// ─── Public cost API ───────────────────────────────────────────────────────

/**
 * Final uplift + $5 re-round applied to every non-zero freight cost.
 * Single audit point for "how much more expensive is the customer-facing
 * rate than the pre-uplift model number" — change one constant in
 * shipping.json and every rate shifts together.
 */
function applyGlobalUplift(cost: number): number {
  if (cost <= 0) return cost;
  const m = SHIPPING.globalFreightMultiplier ?? 1;
  return Math.ceil((cost * m) / 5) * 5;
}

export function shippingCost(
  mode: ShippingMode,
  panels: Panel[],
): { cost: number; label: string } {
  switch (mode.kind) {
    case "unset":
      return { cost: 0, label: "" };
    case "delivering":
      return { cost: 0, label: "" };
    case "pickup":
      return { cost: 0, label: "Pickup from workshop" };
    case "chchMetro":
      return {
        cost: applyGlobalUplift(SHIPPING.chchMetroFlat),
        label: "Christchurch Metro",
      };
    case "chchSurrounds":
      return {
        cost: applyGlobalUplift(SHIPPING.chchSurroundsFlat),
        label: "Christchurch surrounds",
      };
    case "nationwide": {
      if (!mode.destination || !(mode.destination in SHIPPING.destinations)) {
        return { cost: 0, label: "Nationwide — select a destination" };
      }
      const kg = jobWeightKg(panels);
      const base = nationwideForDestination(mode.destination, kg, panels);
      return {
        cost: applyGlobalUplift(base),
        label: mode.destination,
      };
    }
    case "other":
      return { cost: 0, label: "Freight to be confirmed" };
  }
}

export function shippingLabel(mode: ShippingMode): string {
  return shippingCost(mode, []).label;
}
