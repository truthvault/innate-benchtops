import { useEffect, useMemo, useRef, useState } from "react";
import type { Totals } from "../pricing";
import { formatNZD } from "../pricing";
import type { ShippingMode } from "../shipping";
import type { FinishId } from "../species";
import { formatDispatchWeek } from "../dispatch-date";
import { AddressSearch } from "./AddressSearch";

interface Props {
  totals: Totals;
  shippingMode: ShippingMode;
  finish: FinishId;
  leadTimeWeeks: number;
  /** True when at least one panel meets the full main-benchtop spec
   *  (see quoteHasMainPanel in src/state.ts). When false, Share is
   *  HTML-disabled and a persistent warning sits above the button. */
  hasMainPanel: boolean;
  onFinishChange: (f: FinishId) => void;
  onShippingChange: (m: ShippingMode) => void;
  onRequest: () => void;
}

export function StickyBar({
  totals, shippingMode, finish, leadTimeWeeks, hasMainPanel,
  onFinishChange, onShippingChange, onRequest,
}: Props) {
  const [prior, setPrior] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Ticks up each time the user hits Share while delivery isn't resolved —
  // drives the address-search focus + a brief pulse on the delivery panel.
  const [addressFocusSignal, setAddressFocusSignal] = useState(0);
  const [isPrompting, setIsPrompting] = useState(false);
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
  // Dispatch estimate: rounded to the Monday of (today + leadTimeWeeks).
  // Computed inline here rather than passed in so the chip stays in sync
  // with whatever lead-time the priceQuote() result currently produces.
  const dispatchWeek = useMemo(
    () => formatDispatchWeek(new Date(), leadTimeWeeks),
    [leadTimeWeeks],
  );
  const isOther = shippingMode.kind === "other";
  const isUnset = shippingMode.kind === "unset";
  const isDelivering = shippingMode.kind === "delivering";
  const isPickup = shippingMode.kind === "pickup";
  // "Delivered" highlight & input render: user has either clicked the
  // Delivered button (→ 'delivering') or already resolved an address.
  const isDelivered =
    isDelivering
    || shippingMode.kind === "chchMetro"
    || shippingMode.kind === "chchSurrounds"
    || shippingMode.kind === "nationwide"
    || shippingMode.kind === "other";
  // Share is only allowed once the customer has explicitly picked pickup
  // or a resolved delivery address, AND the quote contains at least one
  // bench-sized panel. The two gates use different mechanisms by design:
  //   - !hasMainPanel  → HTML `disabled` attribute on the button, plus a
  //     persistent inline warning. The customer can't click their way
  //     through; the only path forward is to grow a panel.
  //   - delivery unset → button stays clickable so a click can flash the
  //     in-bar prompt + auto-focus the address input. Less obstructive,
  //     because an unset delivery is a near-final step, not a config bug.
  const canShare = !isUnset && !isDelivering && hasMainPanel;
  const shareDisabledReason = !hasMainPanel
    ? "Add a benchtop 1200 × 250 × 20 mm or larger"
    : isUnset || isDelivering
      ? "Pick a delivery location first"
      : undefined;

  const pickPickup = () => onShippingChange({ kind: "pickup" });
  const pickDelivered = () => {
    // Enter a "delivering, no address yet" waypoint. Stays in this state
    // until the customer picks an address (→ chchMetro / nationwide / …).
    if (!isDelivered) onShippingChange({ kind: "delivering" });
  };

  const attemptShare = () => {
    if (canShare) {
      onRequest();
      return;
    }
    // Invalid — show a hint above the button and flash the right surface.
    setIsPrompting(true);
    window.setTimeout(() => setIsPrompting(false), 2400);

    if (hasMainPanel && (isUnset || isDelivering)) {
      // Point them straight at the address input.
      if (isUnset) onShippingChange({ kind: "delivering" });
      setAddressFocusSignal((n) => n + 1);
    }
  };

  const freightPrice =
    shippingMode.kind === "other"
      ? "TBC"
      : totals.shipping.cost > 0
        ? formatNZD(totals.shipping.cost)
        : shippingMode.kind === "pickup"
          ? "free"
          : "—";

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
          <div className="stickybar__group">
            <span className="stickybar__group-label">Finish</span>
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
          </div>

          {/* Delivery: Pickup / Delivered segmented + address input */}
          <div className="stickybar__group">
            <span className="stickybar__group-label">Delivery</span>
            <div
              className={
                "stickybar__delivery"
                + ((isUnset || isDelivering) ? " is-needs-attention" : "")
                + (isPrompting ? " is-prompting" : "")
              }
            >
              <div className="stickybar__finish" role="radiogroup" aria-label="Delivery method">
                <button
                  type="button"
                  role="radio"
                  aria-checked={isPickup}
                  className={`stickybar__finish-btn${isPickup ? " is-on" : ""}`}
                  onClick={pickPickup}
                >
                  Pick up
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isDelivered}
                  className={`stickybar__finish-btn${isDelivered ? " is-on" : ""}`}
                  onClick={pickDelivered}
                >
                  Deliver<span className="stickybar__finish-btn-suffix"> to me</span>
                </button>
              </div>
              {isDelivered && (
                <AddressSearch
                  value={shippingMode}
                  shippingCost={totals.shipping.cost}
                  shippingLabel={totals.shipping.label}
                  onChange={onShippingChange}
                  autoFocus={isDelivering}
                  focusSignal={addressFocusSignal}
                />
              )}
            </div>
          </div>

          <div className="stickybar__lead" aria-label="Estimated dispatch">
            Approx. dispatch · {dispatchWeek}
          </div>
          <div className="stickybar__cta-wrap">
            {!hasMainPanel && (
              <div className="stickybar__warning" role="status" aria-live="polite">
                Add a benchtop 1200 × 250 × 20 mm or larger to send this quote.
              </div>
            )}
            {hasMainPanel && isPrompting && !canShare && (
              <div className="stickybar__hint" role="status" aria-live="polite">
                Enter a delivery address or choose Pick up
              </div>
            )}
            <button
              type="button"
              className="btn-primary stickybar__cta"
              onClick={attemptShare}
              disabled={!hasMainPanel}
              aria-disabled={!canShare}
              title={shareDisabledReason}
            >
              Share this quote
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Price — far right, aligned with the right edge of the main content */}
          <button
            type="button"
            className={`stickybar__price stickybar__price--btn${expanded ? " is-expanded" : ""}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide price breakdown" : "View price breakdown"}
          >
            <span className="stickybar__amount" data-dir={direction ?? undefined}>
              {formatNZD(totals.grand)}
            </span>
            <span className="stickybar__note">
              {isOther ? "+ freight TBC · incl GST" : "incl GST"}
            </span>
            <span className="stickybar__breakdown-link">
              {expanded ? "Hide breakdown" : "View breakdown"}
              <svg className="stickybar__chevron" viewBox="0 0 16 16" width="11" height="11" aria-hidden>
                <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
