import { useEffect, useRef, useState } from "react";
import { formatNZD } from "../pricing";

interface Props {
  grand: number;
  leadTimeWeeks: number;
  onRequest: () => void;
}

export function StickyBar({ grand, leadTimeWeeks, onRequest }: Props) {
  const [prior, setPrior] = useState<number | null>(null);
  const last = useRef(grand);

  useEffect(() => {
    const prev = last.current;
    if (prev !== grand) {
      if (prev > 0 && grand > 0) {
        setPrior(prev);
        const t = window.setTimeout(() => setPrior(null), 1100);
        last.current = grand;
        return () => window.clearTimeout(t);
      }
      last.current = grand;
    }
  }, [grand]);

  const direction = prior !== null ? (grand > prior ? "up" : "down") : null;

  return (
    <div className="stickybar" role="region" aria-label="Quote total">
      <div className="stickybar__inner">
        <div className="stickybar__price">
          <span className="stickybar__amount" aria-live="polite" data-dir={direction ?? undefined}>
            {formatNZD(grand)}
          </span>
          <span className="stickybar__note">incl GST</span>
        </div>
        <div className="stickybar__lead" aria-label="Lead time">
          ~{leadTimeWeeks} weeks
        </div>
        <button type="button" className="btn-primary stickybar__cta" onClick={onRequest}>
          Share this quote
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
