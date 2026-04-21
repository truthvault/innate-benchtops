import { useMemo, useState } from "react";
import {
  DESTINATIONS_GROUPED,
  SHIPPING,
  matchAddress,
  resolveLocation,
  type ShippingMode,
} from "../shipping";

interface Props {
  value: ShippingMode;
  address: string;
  onChange: (mode: ShippingMode) => void;
  onAddressChange: (s: string) => void;
}

type DeliveryKind = "pickup" | "delivered";

export function DeliveryPicker({ value, address, onChange, onAddressChange }: Props) {
  const kind: DeliveryKind = value.kind === "pickup" ? "pickup" : "delivered";
  const match = useMemo(() => matchAddress(address), [address]);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const pickKind = (k: DeliveryKind) => {
    if (k === "pickup") {
      onChange({ kind: "pickup" });
      return;
    }
    // Switching to delivered — try to resolve from any existing address
    const m = matchAddress(address);
    if (m) {
      onChange(m.mode);
    } else if (value.kind === "pickup") {
      // Placeholder; user will pick a destination
      onChange({ kind: "nationwide", destination: "" });
    }
  };

  const onAddressInput = (text: string) => {
    onAddressChange(text);
    const m = matchAddress(text);
    if (m) onChange(m.mode);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocError("Location not available in this browser.");
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const resolved = resolveLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        onChange(resolved.mode);
        // Prefill address text for context
        if (resolved.mode.kind === "nationwide") {
          onAddressChange(resolved.mode.destination);
        } else if (resolved.mode.kind === "chchMetro") {
          onAddressChange("Christchurch");
        } else if (resolved.mode.kind === "chchSurrounds") {
          onAddressChange("Christchurch surrounds");
        }
      },
      (err) => {
        setLocating(false);
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : "Could not get your location.",
        );
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  const fallbackValue =
    value.kind === "chchMetro"
      ? "chchMetro"
      : value.kind === "chchSurrounds"
        ? "chchSurrounds"
        : value.kind === "nationwide"
          ? value.destination
          : "";

  const onFallbackPick = (v: string) => {
    if (v === "") return;
    if (v === "chchMetro") onChange({ kind: "chchMetro" });
    else if (v === "chchSurrounds") onChange({ kind: "chchSurrounds" });
    else onChange({ kind: "nationwide", destination: v });
  };

  const resolved: { label: string; priceLabel: string; confidence: "high" | "low" } | null = useMemo(() => {
    if (kind === "pickup") return null;
    if (match) return { label: match.label, priceLabel: match.priceLabel, confidence: match.confidence };
    if (value.kind === "chchMetro") {
      return { label: "Christchurch Metro", priceLabel: `$${SHIPPING.chchMetroFlat}`, confidence: "high" };
    }
    if (value.kind === "chchSurrounds") {
      return { label: "Christchurch surrounds", priceLabel: `$${SHIPPING.chchSurroundsFlat}`, confidence: "high" };
    }
    if (value.kind === "nationwide" && value.destination) {
      return { label: `${value.destination} — nationwide`, priceLabel: "Weight-based", confidence: "high" };
    }
    return null;
  }, [kind, match, value]);

  return (
    <section className="delivery" aria-labelledby="delivery-h">
      <header className="section-head">
        <h2 id="delivery-h">Delivery</h2>
      </header>

      <div className="seg seg--stack" role="radiogroup" aria-label="Delivery">
        <button
          type="button"
          role="radio"
          aria-checked={kind === "pickup"}
          className={`seg__opt${kind === "pickup" ? " is-on" : ""}`}
          onClick={() => pickKind("pickup")}
        >
          <span className="seg__dot" aria-hidden />
          <span className="seg__text">
            <span className="seg__title">Pickup from workshop</span>
            <span className="seg__sub">281 Queen Elizabeth II Drive, Christchurch · free</span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={kind === "delivered"}
          className={`seg__opt${kind === "delivered" ? " is-on" : ""}`}
          onClick={() => pickKind("delivered")}
        >
          <span className="seg__dot" aria-hidden />
          <span className="seg__text">
            <span className="seg__title">Delivered to me</span>
            <span className="seg__sub">Flat rate in Christchurch · weight-based for the rest of NZ</span>
          </span>
        </button>
      </div>

      {kind === "delivered" && (
        <div className="delivery__picker">
          <label className="delivery__address">
            <span className="numfield__label">Town, suburb, or postcode</span>
            <input
              type="text"
              value={address}
              onChange={(e) => onAddressInput(e.target.value)}
              placeholder="e.g. Rolleston, 8022, Dunedin"
              autoComplete="address-level2"
            />
          </label>

          <div className="delivery__location">
            <button
              type="button"
              className="btn-ghost delivery__loc-btn"
              onClick={useMyLocation}
              disabled={locating}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <circle cx="8" cy="8" r="2.5" fill="currentColor" />
                <path d="M8 .5v3M8 12.5v3M.5 8h3M12.5 8h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              {locating ? "Locating…" : "Use my location"}
            </button>
            {locError && <span className="delivery__loc-err">{locError}</span>}
          </div>

          {resolved && (
            <div className={`delivery__resolved delivery__resolved--${resolved.confidence}`}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M3 8.5l3 3L13 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="delivery__resolved-label">{resolved.label}</span>
              <span className="delivery__resolved-price">{resolved.priceLabel}</span>
            </div>
          )}

          <label className="delivery__fallback">
            <span className="numfield__label">Not recognised? Pick manually</span>
            <select value={fallbackValue} onChange={(e) => onFallbackPick(e.target.value)}>
              <option value="">— Select destination —</option>
              <optgroup label="Christchurch">
                <option value="chchMetro">Christchurch Metro · ${SHIPPING.chchMetroFlat}</option>
                <option value="chchSurrounds">Christchurch surrounds · ${SHIPPING.chchSurroundsFlat}</option>
              </optgroup>
              {DESTINATIONS_GROUPED.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.destinations.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}
