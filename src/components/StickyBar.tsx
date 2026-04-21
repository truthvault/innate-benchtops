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

  const useMyLocation = async () => {
    setLocMsg("Finding your nearest destination…");
    setLocating(true);
    try {
      const res = await fetch("/api/locate");
      const data = (await res.json()) as {
        ok?: boolean;
        lat?: number;
        lng?: number;
        city?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || data.lat == null || data.lng == null) {
        setLocMsg(
          data.error ||
            "Couldn't find your location automatically. Pick from the dropdown.",
        );
        return;
      }
      const r = resolveLocation({ lat: data.lat, lng: data.lng });
      onShippingChange(r.mode);
      const near = data.city ? ` (near ${data.city})` : "";
      setLocMsg(`✓ Set to ${r.label}${near}`);
      window.setTimeout(
        () => setLocMsg((m) => (m?.startsWith("✓") ? null : m)),
        3500,
      );
    } catch (e) {
      setLocMsg(
        e instanceof Error
          ? `Couldn't reach the location service (${e.message}). Pick from the dropdown.`
          : "Couldn't reach the location service. Pick from the dropdown.",
      );
    } finally {
      setLocating(false);
    }
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
        <div className="stickybar__inner">
          {/* Finish */}
          <div className="stickybar__finish" role="radiogroup" aria-label="Finish">
            <button
              type="button"
              role="radio"
              aria-checked={finish === "oiled"}
              className={`stickybar__finish-btn${finish === "oiled" ? " is-on" : ""}`}
              onClick={() => onFinishChange("oiled")}
            >
              Oiled
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={finish === "raw"}
              className={`stickybar__finish-btn${finish === "raw" ? " is-on" : ""}`}
              onClick={() => onFinishChange("raw")}
            >
              Raw
            </button>
          </div>

          {/* Delivery */}
          <div className={`stickybar__delivery${isUnset ? " is-needs-attention" : ""}`}>
            <select
              className="stickybar__delivery-select"
              value={modeToValue(shippingMode)}
              onChange={(e) => onShippingChange(valueToMode(e.target.value))}
              aria-label="Delivery location"
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
              className="stickybar__delivery-loc"
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

          {/* Price (pushed right) */}
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
            ~{leadTimeWeeks}w
          </div>
          <button
            type="button"
            className="btn-primary stickybar__cta"
            onClick={onRequest}
            disabled={!canShare}
            title={canShare ? undefined : "Pick a delivery location first"}
          >
            Share this quote
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {locMsg && <div className="stickybar__loc-msg">{locMsg}</div>}
      </div>
    </>
  );
}
