import { useState } from "react";
import {
  DESTINATIONS_GROUPED,
  SHIPPING,
  resolveLocation,
  type ShippingMode,
} from "../shipping";

interface Props {
  value: ShippingMode;
  /** Not used any more — kept for API compatibility with App.tsx */
  address: string;
  onChange: (mode: ShippingMode) => void;
  /** Not used any more — kept for API compatibility with App.tsx */
  onAddressChange: (s: string) => void;
}

// Map between the <select> value strings and ShippingMode
function modeToValue(m: ShippingMode): string {
  switch (m.kind) {
    case "pickup":
      return "pickup";
    case "chchMetro":
      return "chchMetro";
    case "chchSurrounds":
      return "chchSurrounds";
    case "nationwide":
      return m.destination ? `nw:${m.destination}` : "";
    case "other":
      return "other";
  }
}

function valueToMode(v: string): ShippingMode | null {
  if (v === "pickup") return { kind: "pickup" };
  if (v === "chchMetro") return { kind: "chchMetro" };
  if (v === "chchSurrounds") return { kind: "chchSurrounds" };
  if (v === "other") return { kind: "other" };
  if (v.startsWith("nw:")) return { kind: "nationwide", destination: v.slice(3) };
  return null;
}

function priceTag(mode: ShippingMode): string {
  switch (mode.kind) {
    case "pickup":
      return "free";
    case "chchMetro":
      return `$${SHIPPING.chchMetroFlat}`;
    case "chchSurrounds":
      return `$${SHIPPING.chchSurroundsFlat}`;
    case "nationwide":
      return mode.destination ? "weight-based freight" : "";
    case "other":
      return "TBC";
  }
}

export function DeliveryPicker({ value, onChange }: Props) {
  const [locating, setLocating] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);

  const useMyLocation = () => {
    setLocMsg(null);
    if (!navigator.geolocation) {
      setLocMsg("Your browser doesn't support location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const resolved = resolveLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        onChange(resolved.mode);
        setLocMsg(`${resolved.label} — picked for you.`);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocMsg(
            "Location permission blocked. On macOS, enable Chrome in System Settings → Privacy & Security → Location Services, then reload.",
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setLocMsg("Couldn't read your location right now. Try picking from the list.");
        } else {
          setLocMsg("Location request timed out. Try picking from the list.");
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 },
    );
  };

  const onPick = (v: string) => {
    const mode = valueToMode(v);
    if (mode) onChange(mode);
  };

  return (
    <section className="delivery" aria-labelledby="delivery-h">
      <header className="section-head">
        <h2 id="delivery-h">Delivery</h2>
      </header>

      <label className="delivery__select">
        <span className="numfield__label">Where to?</span>
        <select
          value={modeToValue(value)}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="pickup">Pickup from workshop — free</option>
          <optgroup label="Christchurch">
            <option value="chchMetro">Christchurch Metro — ${SHIPPING.chchMetroFlat}</option>
            <option value="chchSurrounds">Christchurch surrounds — ${SHIPPING.chchSurroundsFlat}</option>
          </optgroup>
          {DESTINATIONS_GROUPED.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.destinations.map((d) => (
                <option key={d} value={`nw:${d}`}>{d}</option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Somewhere else">
            <option value="other">Other — we'll confirm freight with you</option>
          </optgroup>
        </select>
        <p className="delivery__hint">
          Can't see your town? Pick the nearest, or choose <em>Other</em> — the
          list covers our freight partners' main destinations.
        </p>
      </label>

      <div className="delivery__tag" aria-live="polite">
        <span className="delivery__tag-label">
          {value.kind === "pickup" && "Pickup at 281 Queen Elizabeth II Drive, Christchurch"}
          {value.kind === "chchMetro" && "Christchurch Metro flat rate"}
          {value.kind === "chchSurrounds" && "Christchurch surrounds flat rate"}
          {value.kind === "nationwide" && value.destination &&
            `Nationwide freight · ${value.destination}`}
          {value.kind === "nationwide" && !value.destination &&
            "Select a destination above"}
          {value.kind === "other" &&
            "We'll quote freight for your address when we come back to you"}
        </span>
        <span className="delivery__tag-price">{priceTag(value)}</span>
      </div>

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
        {locMsg && <p className="delivery__loc-msg">{locMsg}</p>}
      </div>
    </section>
  );
}
