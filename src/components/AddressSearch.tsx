import { useEffect, useId, useRef, useState } from "react";
import { resolveLocation, type ShippingMode } from "../shipping";
import { formatNZD } from "../pricing";

interface Prediction {
  id: string;
  text: string;
  mainText: string;
  secondaryText: string;
}

interface Props {
  value: ShippingMode;
  /** Pre-computed cost for the current mode (comes from priceQuote totals) */
  shippingCost: number;
  /** Pre-computed label, e.g. "Christchurch Metro" or "Nationwide — Auckland" */
  shippingLabel: string;
  onChange: (mode: ShippingMode) => void;
  /** Focus input when the combobox mounts */
  autoFocus?: boolean;
}

/**
 * Address autocomplete combobox, server-proxied through
 * /api/address-autocomplete (Google Places NZ-restricted).
 * On pick, the place's lat/lng is resolved via haversine to the
 * nearest freight zone and ShippingMode is updated.
 */
export function AddressSearch({
  value, shippingCost: cost, shippingLabel, onChange, autoFocus,
}: Props) {
  const [q, setQ] = useState<string>(() => displayFor(value));
  const [preds, setPreds] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [session] = useState(() => freshSession());

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Auto-focus when requested (e.g. when switching to Delivered mode)
  useEffect(() => {
    if (autoFocus) {
      // Delay a tick so the input is fully painted
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [autoFocus]);

  // Sync prop → input when the value changes externally (adjust-state-during-render pattern)
  const [prevValue, setPrevValue] = useState<ShippingMode>(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!open) {
      const next = displayFor(value);
      if (next !== q) setQ(next);
    }
  }

  // Debounced autocomplete fetch — only runs when a query is worth sending.
  const shouldQuery = q.trim().length >= 3 && q !== displayFor(value);
  useEffect(() => {
    if (!shouldQuery) return;
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/address-autocomplete?q=${encodeURIComponent(q)}&session=${session}`,
          { signal: controller.signal },
        );
        const data = (await res.json()) as { predictions?: Prediction[]; error?: string };
        if (!res.ok) {
          setErr(data.error ?? "Address search unavailable");
          setPreds([]);
        } else {
          setPreds(data.predictions ?? []);
          setErr(null);
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setErr(e instanceof Error ? e.message : "Address search failed");
        setPreds([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [q, session, shouldQuery]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = async (p: Prediction) => {
    setQ(p.text);
    setOpen(false);
    setActive(-1);
    try {
      const res = await fetch(
        `/api/address-details?place_id=${encodeURIComponent(p.id)}&session=${session}`,
      );
      const data = (await res.json()) as {
        lat?: number;
        lng?: number;
        error?: string;
      };
      if (!res.ok || data.lat == null || data.lng == null) {
        setErr(data.error ?? "Couldn't get that location. Try another.");
        return;
      }
      const r = resolveLocation({ lat: data.lat, lng: data.lng });
      onChange(r.mode);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed");
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, preds.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && active >= 0 && preds[active]) {
      e.preventDefault();
      pick(preds[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  // Resolved zone tag (what the customer actually pays for)
  const zoneText =
    value.kind === "unset"
      ? ""
      : value.kind === "pickup"
        ? "Pickup · free"
        : value.kind === "other"
          ? "Freight TBC"
          : `${shippingLabel} · ${cost > 0 ? formatNZD(cost) : "free"}`;

  return (
    <div className="addr-search" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="addr-search__input"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          if (preds.length > 0 || q.trim().length >= 3) setOpen(true);
        }}
        onKeyDown={onKey}
        placeholder="Start typing your address or suburb…"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open && shouldQuery && (preds.length > 0 || loading || err) && (
        <ul className="addr-search__dropdown" id={listId} role="listbox">
          {loading && preds.length === 0 && (
            <li className="addr-search__status">Searching…</li>
          )}
          {err && preds.length === 0 && (
            <li className="addr-search__status addr-search__status--err">{err}</li>
          )}
          {preds.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={`addr-search__opt${i === active ? " is-active" : ""}`}
              onMouseDown={(e) => {
                // mousedown (not click) fires before blur / outside-click closes us
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="addr-search__main">{p.mainText}</span>
              <span className="addr-search__sec">{p.secondaryText}</span>
            </li>
          ))}
        </ul>
      )}
      {zoneText && (
        <span className="addr-search__zone" aria-live="polite">
          → {zoneText}
        </span>
      )}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────

function displayFor(m: ShippingMode): string {
  switch (m.kind) {
    case "unset":
      return "";
    case "pickup":
      return "";
    case "chchMetro":
      return "Christchurch Metro";
    case "chchSurrounds":
      return "Christchurch surrounds";
    case "nationwide":
      return m.destination || "";
    case "other":
      return "";
  }
}

function freshSession(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
