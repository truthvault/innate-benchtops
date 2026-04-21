import { useEffect, useRef, useState } from "react";
import type { Quote, Totals } from "../pricing";
import { formatNZD } from "../pricing";
import { findDelivery, findSpecies, LEAD_TIME_WEEKS } from "../species";

type Stage = "form" | "sending" | "success";

interface Props {
  open: boolean;
  quote: Quote;
  totals: Totals;
  quoteNo: string;
  onClose: () => void;
  onCustomerChange: (c: Quote["customer"]) => void;
  onReset: () => void;
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function QuoteForm({
  open, quote, totals, quoteNo, onClose, onCustomerChange, onReset,
}: Props) {
  const [stage, setStage] = useState<Stage>("form");
  const [touched, setTouched] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  // Reset modal internals when it re-opens — adjusting state during render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStage("form");
      setTouched(false);
      setCopied(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => firstField.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const sp = findSpecies(quote.species);
  const dv = findDelivery(quote.delivery);
  const c = quote.customer;
  const nameOk = c.name.trim().length > 1;
  const emailOk = isEmail(c.email);
  const canSend = nameOk && emailOk && stage === "form";

  const submit = () => {
    setTouched(true);
    if (!nameOk || !emailOk) return;
    setStage("sending");
    window.setTimeout(() => setStage("success"), 820);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="quote-form-h">
      <button type="button" className="modal__scrim" aria-label="Close" onClick={onClose} />
      <div ref={dialog} className="modal__panel" tabIndex={-1}>
        {stage !== "success" && (
          <>
            <header className="modal__head">
              <h2 id="quote-form-h">Request a quote</h2>
              <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <div className="quote-summary">
              <dl>
                <div><dt>Timber</dt><dd>{sp.name}</dd></div>
                <div><dt>Finish</dt><dd>{quote.finish === "oiled" ? "Sanded & oiled" : "Raw, unsanded"}</dd></div>
                <div><dt>Panels</dt><dd>{quote.panels.length} ({panelSummary(quote)})</dd></div>
                <div><dt>Delivery</dt><dd>{dv.label}</dd></div>
                <div><dt>Lead time</dt><dd>~{LEAD_TIME_WEEKS} weeks</dd></div>
                <div className="quote-summary__total">
                  <dt>Total incl GST</dt><dd>{formatNZD(totals.grand)}</dd>
                </div>
              </dl>
              <div className="quote-summary__no">Quote {quoteNo}</div>
            </div>
            <form
              className="quote-form"
              onSubmit={(e) => { e.preventDefault(); submit(); }}
              noValidate
            >
              <label className="field">
                <span>Name</span>
                <input
                  ref={firstField}
                  value={c.name}
                  onChange={(e) => onCustomerChange({ ...c, name: e.target.value })}
                  aria-invalid={touched && !nameOk}
                  autoComplete="name"
                  required
                />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={c.email}
                  onChange={(e) => onCustomerChange({ ...c, email: e.target.value })}
                  aria-invalid={touched && !emailOk}
                  autoComplete="email"
                  required
                />
              </label>
              <label className="field">
                <span>Phone <em>(optional)</em></span>
                <input
                  type="tel"
                  value={c.phone}
                  onChange={(e) => onCustomerChange({ ...c, phone: e.target.value })}
                  autoComplete="tel"
                />
              </label>
              <label className="field field--wide">
                <span>Anything we should know? <em>(optional)</em></span>
                <textarea
                  rows={3}
                  value={c.notes}
                  onChange={(e) => onCustomerChange({ ...c, notes: e.target.value })}
                  placeholder="Special sizes, preferred delivery timing, site access…"
                />
              </label>
              <div className="quote-form__actions">
                <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={!canSend}>
                  {stage === "sending" ? "Sending…" : "Send to workshop"}
                </button>
              </div>
              {touched && (!nameOk || !emailOk) && (
                <p className="quote-form__err" role="alert">
                  {(!nameOk ? "Name is required. " : "")}
                  {(!emailOk ? "A valid email is required." : "")}
                </p>
              )}
            </form>
          </>
        )}

        {stage === "success" && (
          <div className="quote-success">
            <div className="quote-success__check" aria-hidden>
              <svg viewBox="0 0 32 32" width="40" height="40">
                <circle cx="16" cy="16" r="14" fill="#163832" />
                <path d="M9 16.5l4.5 4.5L23 11" stroke="#f3f0ee" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2>Thanks, {c.name.split(" ")[0] || "friend"}.</h2>
            <p>We've logged quote <strong>{quoteNo}</strong>. A real person from the workshop will come back to you within a working day.</p>
            <p className="quote-success__amt">{formatNZD(totals.grand)} incl GST &middot; ~{LEAD_TIME_WEEKS} weeks</p>
            <div className="quote-success__actions">
              <button type="button" className="btn-ghost" onClick={share}>
                {copied ? "Link copied" : "Copy share link"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => window.print()}>
                Print quote
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => { onReset(); onClose(); }}
              >
                Start a new quote
              </button>
            </div>
            <p className="quote-success__note">
              This is a prototype — no email was sent. A production build would deliver this summary to hello@innatefurniture.co.nz.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function panelSummary(q: Quote) {
  return q.panels
    .map((p) => `${p.length}×${p.width}×${p.thickness}mm × ${p.quantity}`)
    .join(", ");
}
