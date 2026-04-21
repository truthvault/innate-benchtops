import { useEffect, useRef, useState } from "react";
import type { Quote, Totals } from "../pricing";
import { formatNZD } from "../pricing";
import { findSpecies } from "../species";
import { shippingLabel } from "../shipping";

type SharePath = "self" | "workshop" | "other";
type Stage = "choose" | "form" | "sending" | "success" | "error";

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

const PATHS: { id: SharePath; title: string; sub: string }[] = [
  {
    id: "self",
    title: "Email it to me",
    sub: "Send this quote to your own inbox, with a link to reopen it later.",
  },
  {
    id: "workshop",
    title: "Send to workshop",
    sub: "Start a conversation — a real person from the workshop will follow up.",
  },
  {
    id: "other",
    title: "Send to someone else",
    sub: "Share it with your partner, designer, or builder.",
  },
];

export function QuoteForm({
  open, quote, totals, quoteNo, onClose, onCustomerChange, onReset,
}: Props) {
  const [stage, setStage] = useState<Stage>("choose");
  const [path, setPath] = useState<SharePath>("self");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientNote, setRecipientNote] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState(false);

  const dialog = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);

  // Reset when modal re-opens
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStage("choose");
      setPath("self");
      setRecipientName("");
      setRecipientEmail("");
      setRecipientNote("");
      setTouched(false);
      setErrorMsg(null);
      setCopied(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => firstField.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const sp = findSpecies(quote.species);
  const deliveryText = shippingLabel(quote.shipping);
  const c = quote.customer;

  const nameOk = c.name.trim().length > 1;
  const emailOk = isEmail(c.email);
  const phoneOk = !!c.phone?.trim();
  const recipNameOk = recipientName.trim().length > 1;
  const recipEmailOk = isEmail(recipientEmail);

  const canSend = (() => {
    if (!nameOk || !emailOk) return false;
    if (path === "workshop" && !phoneOk) return false;
    if (path === "other" && (!recipNameOk || !recipEmailOk)) return false;
    return true;
  })();

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  const submit = async () => {
    setTouched(true);
    if (!canSend) return;
    setStage("sending");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/send-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          customer: {
            name: c.name.trim(),
            email: c.email.trim(),
            phone: c.phone?.trim() || undefined,
            notes: c.notes?.trim() || undefined,
          },
          recipient:
            path === "other"
              ? {
                  name: recipientName.trim(),
                  email: recipientEmail.trim(),
                  noteToRecipient: recipientNote.trim() || undefined,
                }
              : undefined,
          quote: {
            species: sp.label ?? sp.name,
            finish: quote.finish,
            panels: quote.panels.map((p) => ({
              label: p.label,
              length: p.length,
              width: p.width,
              thickness: p.thickness,
              quantity: p.quantity,
              cutouts: p.cutouts.map((cu) => ({
                widthMm: cu.widthMm,
                depthMm: cu.depthMm,
                pos: cu.pos,
                cross: cu.cross,
              })),
            })),
          },
          quoteNo,
          totals: {
            grand: totals.grand,
            leadTimeWeeks: totals.leadTimeWeeks,
            shipping: totals.shipping,
          },
          shareUrl,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || `Send failed (${res.status})`);
        setStage("error");
        return;
      }

      setStage("success");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Network error");
      setStage("error");
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
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
        {/* ── STAGE: Choose path ─────────────────────────────── */}
        {stage === "choose" && (
          <>
            <header className="modal__head">
              <h2 id="quote-form-h">Share this quote</h2>
              <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <QuoteSummary
              quote={quote}
              totals={totals}
              quoteNo={quoteNo}
              deliveryText={deliveryText}
              speciesLabel={sp.label ?? sp.name}
            />
            <div className="share-paths" role="list">
              {PATHS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="share-path"
                  onClick={() => { setPath(p.id); setStage("form"); }}
                >
                  <PathIcon id={p.id} />
                  <span className="share-path__text">
                    <span className="share-path__title">{p.title}</span>
                    <span className="share-path__sub">{p.sub}</span>
                  </span>
                  <svg viewBox="0 0 16 16" width="12" height="12" className="share-path__arrow" aria-hidden>
                    <path d="M5 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ))}
            </div>
            <p className="share-reassure">
              No payment taken. We'll email this quote and may follow up to help.
            </p>
          </>
        )}

        {/* ── STAGE: Details form ───────────────────────────── */}
        {(stage === "form" || stage === "sending" || stage === "error") && (
          <>
            <header className="modal__head">
              <button type="button" className="modal__back" onClick={() => setStage("choose")}>
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                  <path d="M11 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
              <h2>{PATHS.find((p) => p.id === path)!.title}</h2>
              <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <QuoteSummary
              quote={quote}
              totals={totals}
              quoteNo={quoteNo}
              deliveryText={deliveryText}
              speciesLabel={sp.label ?? sp.name}
            />

            <form
              className="quote-form"
              onSubmit={(e) => { e.preventDefault(); submit(); }}
              noValidate
            >
              <label className="field">
                <span>Your name</span>
                <input
                  ref={firstField}
                  value={c.name}
                  onChange={(e) => onCustomerChange({ ...c, name: e.target.value })}
                  aria-invalid={touched && !nameOk}
                  autoComplete="name"
                />
              </label>
              <label className="field">
                <span>Your email</span>
                <input
                  type="email"
                  value={c.email}
                  onChange={(e) => onCustomerChange({ ...c, email: e.target.value })}
                  aria-invalid={touched && !emailOk}
                  autoComplete="email"
                />
              </label>
              <label className="field">
                <span>
                  Phone
                  {path === "self" || path === "other" ? <em> (optional)</em> : null}
                </span>
                <input
                  type="tel"
                  value={c.phone}
                  onChange={(e) => onCustomerChange({ ...c, phone: e.target.value })}
                  aria-invalid={touched && path === "workshop" && !phoneOk}
                  autoComplete="tel"
                />
              </label>

              {path === "other" && (
                <>
                  <label className="field">
                    <span>Recipient name</span>
                    <input
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      aria-invalid={touched && !recipNameOk}
                    />
                  </label>
                  <label className="field">
                    <span>Recipient email</span>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      aria-invalid={touched && !recipEmailOk}
                    />
                  </label>
                  <label className="field field--wide">
                    <span>Note to {recipientName.split(" ")[0] || "them"} <em>(optional)</em></span>
                    <textarea
                      rows={2}
                      value={recipientNote}
                      onChange={(e) => setRecipientNote(e.target.value)}
                      placeholder="e.g. thinking about this for the kitchen — what do you reckon?"
                    />
                  </label>
                </>
              )}

              <label className="field field--wide">
                <span>Anything else we should know? <em>(optional)</em></span>
                <textarea
                  rows={2}
                  value={c.notes}
                  onChange={(e) => onCustomerChange({ ...c, notes: e.target.value })}
                  placeholder={path === "workshop"
                    ? "Install date, site access, finish preferences…"
                    : "Anything you'd like us to know."}
                />
              </label>

              {path === "other" && (
                <p className="share-disclose">
                  We'll also send a copy to the workshop for record-keeping — they won't contact you unless you ask.
                </p>
              )}

              <div className="quote-form__actions">
                <button type="button" className="btn-ghost" onClick={() => setStage("choose")}>
                  Back
                </button>
                <button type="submit" className="btn-primary" disabled={!canSend || stage === "sending"}>
                  {stage === "sending" ? "Sending…" : "Send quote"}
                </button>
              </div>

              {touched && !canSend && (
                <p className="quote-form__err" role="alert">
                  {!nameOk && "Your name is required. "}
                  {!emailOk && "A valid email is required. "}
                  {path === "workshop" && !phoneOk && "Phone is required. "}
                  {path === "other" && !recipNameOk && "Recipient name is required. "}
                  {path === "other" && !recipEmailOk && "Recipient email is required."}
                </p>
              )}

              {stage === "error" && errorMsg && (
                <p className="quote-form__err" role="alert">
                  {errorMsg}. <button type="button" className="btn-ghost" onClick={submit}>Try again</button>
                </p>
              )}

              <p className="share-reassure share-reassure--form">
                No payment taken. We'll email this quote and may follow up to help.
              </p>
            </form>
          </>
        )}

        {/* ── STAGE: Success ─────────────────────────────────── */}
        {stage === "success" && (
          <div className="quote-success">
            <div className="quote-success__check" aria-hidden>
              <svg viewBox="0 0 32 32" width="40" height="40">
                <circle cx="16" cy="16" r="14" fill="#163832" />
                <path d="M9 16.5l4.5 4.5L23 11" stroke="#f3f0ee" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2>
              {path === "self" && "Quote sent"}
              {path === "workshop" && "Quote sent to the workshop"}
              {path === "other" && `Quote sent to ${recipientName.split(" ")[0] || "them"}`}
            </h2>
            <p>
              {path === "self" && "Check your inbox for this quote and a link to reopen it."}
              {path === "workshop" && "Someone from the workshop will be in touch soon to talk through details."}
              {path === "other" && "They'll receive the full quote and a link to explore it."}
            </p>
            <p className="quote-success__amt">
              {formatNZD(totals.grand)} incl GST · ~{totals.leadTimeWeeks} weeks
            </p>

            <div className="quote-success__sharebox">
              <code className="quote-success__url">{shareUrl}</code>
              <button type="button" className="btn-ghost" onClick={copyShareLink}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>

            <div className="quote-success__actions">
              <button type="button" className="btn-ghost" onClick={() => window.print()}>
                Print quote
              </button>
              <button type="button" className="btn-primary" onClick={() => { onReset(); onClose(); }}>
                Start a new quote
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reusable summary block ───────────────────────────────────

function QuoteSummary({
  quote, totals, quoteNo, deliveryText, speciesLabel,
}: {
  quote: Quote;
  totals: Totals;
  quoteNo: string;
  deliveryText: string;
  speciesLabel: string;
}) {
  return (
    <div className="quote-summary">
      <dl>
        <div><dt>Timber</dt><dd>{speciesLabel}</dd></div>
        <div><dt>Finish</dt><dd>{quote.finish === "oiled" ? "Sanded & oiled" : "Raw, unsanded"}</dd></div>
        <div><dt>Panels</dt><dd>{quote.panels.length} ({panelSummary(quote)})</dd></div>
        <div><dt>Delivery</dt><dd>{deliveryText}{totals.shipping.cost > 0 ? ` · ${formatNZD(totals.shipping.cost)}` : ""}</dd></div>
        <div><dt>Lead time</dt><dd>~{totals.leadTimeWeeks} weeks</dd></div>
        <div className="quote-summary__total">
          <dt>Total incl GST</dt><dd>{formatNZD(totals.grand)}</dd>
        </div>
      </dl>
      <div className="quote-summary__no">Quote {quoteNo}</div>
    </div>
  );
}

function PathIcon({ id }: { id: SharePath }) {
  if (id === "self") {
    return (
      <svg className="share-path__icon" viewBox="0 0 20 20" width="22" height="22" aria-hidden>
        <rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2.5 5.5L10 11l7.5-5.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === "workshop") {
    return (
      <svg className="share-path__icon" viewBox="0 0 20 20" width="22" height="22" aria-hidden>
        <path d="M3 9l7-5 7 5v7H3V9z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M8 16v-4h4v4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="share-path__icon" viewBox="0 0 20 20" width="22" height="22" aria-hidden>
      <circle cx="5.5" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14.5" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14.5" cy="15" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.3 9.1l5.4-3.2M7.3 10.9l5.4 3.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function panelSummary(q: Quote) {
  return q.panels
    .map((p) => `${p.length}×${p.width}×${p.thickness}mm × ${p.quantity}`)
    .join(", ");
}
