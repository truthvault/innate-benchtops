import { useEffect, useRef, useState } from "react";
import type { Totals } from "../pricing";
import { formatNZD } from "../pricing";
import {
  DESTINATIONS_GROUPED,
  SHIPPING,
  resolveLocation,
  type ShippingMode,
} from "../shipping";
import type { FinishId } from "../species";

interface Props {
  totals: Totals;
  shippingMode: ShippingMode;
  finish: FinishId;
  leadTimeWeeks: number;
  onFinishChange: (f: FinishId) => void;
  onShippingChange: (m: ShippingMode) => void;
  onRequest: () => void;
}

// ─── dropdown serialisation ───────────────────────────────────────────

function modeToValue(m: ShippingMode): string {
  switch (m.kind) {
    case "unset": return "";
    case "pickup": return "pickup";
    case "chchMetro": return "chchMetro";
    case "chchSurrounds": return "chchSurrounds";
    case "nationwide": return m.destination ? `nw:${m.destination}` : "";
    case "other": return "other";
  }
}

function valueToMode(v: string): ShippingMode {
  if (v === "") return { kind: "unset" };
  if (v === "pickup") return { kind: "pickup" };
  if (v === "chchMetro") return { kind: "chchMetro" };
  if (v === "chchSurrounds") return { kind: "chchSurrounds" };
  if (v === "other") return { kind: "other" };
  if (v.startsWith("nw:")) return { kind: "nationwide", destination: v.slice(3) };
  return { kind: "unset" };
}

export function StickyBar({
  totals, shippingMode, finish, leadTimeWeeks,
  onFinishChange, onShippingChange, onRequest,
}: Props) {
  const [prior, setPrior] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const last = useRef(totals.grand);

  useEffect(() => {
    const prev = last.current;
    if (prev !== totals.grand) {
      if (prev > 0 && totals.grand > 0) {
        setPrior(prev);
        const t = window.setTimeout(() => setPrior(null), 1100);
        last.current = totals.grand;
        return () => window.clearTimeout(t);
      }
      last.current = totals.grand;
    }
  }, [totals.grand]);

  const direction = prior !== null ? (totals.grand > prior ? "up" : "down") : null;
  const isOther = shippingMode.kind === "other";
  const isUnset = shippingMode.kind === "unset";
  const canShare = !isUnset;

  const freightPrice =
    shippingMode.kind === "other"
      ? "TBC"
      : totals.shipping.cost > 0
        ? formatNZD(totals.shipping.cost)
        : shippingMode.kind === "pickup"
          ? "free"
          : "—";

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
        const r = resolveLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        onShippingChange(r.mode);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocMsg("Location blocked. Enable it in macOS Privacy & Security → Location Services → Chrome.");
        } else {
          setLocMsg("Couldn't read your location. Pick from the list above.");
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 },
    );
  };

  return (
    <>
      {expanded && (
        <div className="stickybar__breakdown" role="region" aria-label="Quote breakdown">
          <div className="stickybar__breakdown-inner">
            <ul className="stickybar__items">
              {totals.lines.map((line) => {
                const p = line.panel;
                const label = p.label.trim() || "Panel";
                const dim = `${p.length}×${p.width}×${p.thickness} mm`;
                const qty = p.quantity > 1 ? ` · ×${p.quantity}` : "";
                return (
                  <li key={p.id}>
                    <span className="stickybar__item-label">
                      {label}
                      <em>{dim}{qty}</em>
                    </span>
                    <span className="stickybar__item-price">{formatNZD(line.priceTotal)}</span>
                  </li>
                );
              })}
              <li className="stickybar__item--freight">
                <span className="stickybar__item-label">
                  Freight
                  <em>{totals.shipping.label || "not selected"}</em>
                </span>
                <span className="stickybar__item-price">{freightPrice}</span>
              </li>
              <li className="stickybar__item--total">
                <span className="stickybar__item-label">Total incl GST</span>
                <span className="stickybar__item-price">
                  {formatNZD(totals.grand)}
                  {isOther && <em> + freight</em>}
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}

      <div className="stickybar" role="region" aria-label="Quote total">
        {/* ── Options row: Finish + Delivery ─────────────────────── */}
        <div className="stickybar__options">
          <div className="stickybar__opt">
            <span className="stickybar__opt-label">Finish</span>
            <div className="stickybar__opt-seg" role="radiogroup" aria-label="Finish">
              <button
                type="button"
                role="radio"
                aria-checked={finish === "oiled"}
                className={`stickybar__opt-seg-btn${finish === "oiled" ? " is-on" : ""}`}
                onClick={() => onFinishChange("oiled")}
              >
                Sanded &amp; oiled
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={finish === "raw"}
                className={`stickybar__opt-seg-btn${finish === "raw" ? " is-on" : ""}`}
                onClick={() => onFinishChange("raw")}
              >
                Raw
              </button>
            </div>
          </div>

          <div className={`stickybar__opt stickybar__opt--grow${isUnset ? " is-needs-attention" : ""}`}>
            <span className="stickybar__opt-label">Delivery</span>
            <div className="stickybar__opt-delivery">
              <select
                className="stickybar__opt-select"
                value={modeToValue(shippingMode)}
                onChange={(e) => onShippingChange(valueToMode(e.target.value))}
              >
                <option value="">— Pick a location —</option>
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
              <button
                type="button"
                className="stickybar__opt-loc"
                onClick={useMyLocation}
                disabled={locating}
                aria-label="Use my location"
                title="Use my location"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                  <circle cx="8" cy="8" r="2.5" fill="currentColor" />
                  <path d="M8 .5v3M8 12.5v3M.5 8h3M12.5 8h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {locMsg && <div className="stickybar__loc-msg">{locMsg}</div>}

        {/* ── Price + lead + CTA row ─────────────────────────────── */}
        <div className="stickybar__inner">
          <button
            type="button"
            className={`stickybar__price stickybar__price--btn${expanded ? " is-expanded" : ""}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide breakdown" : "Show breakdown"}
          >
            <span className="stickybar__amount" data-dir={direction ?? undefined}>
              {formatNZD(totals.grand)}
            </span>
            <span className="stickybar__note">
              {isOther ? "+ freight TBC · incl GST" : "incl GST"}
            </span>
            <svg className="stickybar__chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden>
              <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="stickybar__lead" aria-label="Lead time">
            ~{leadTimeWeeks} weeks
          </div>
          <button
            type="button"
            className="btn-primary stickybar__cta"
            onClick={onRequest}
            disabled={!canShare}
            title={canShare ? undefined : "Pick a delivery location above"}
          >
            Share this quote
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
