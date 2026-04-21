import { useEffect, useRef, useState } from "react";
import type { Quote, Totals } from "../pricing";
import { formatNZD } from "../pricing";
import { findSpecies } from "../species";
import { shippingLabel } from "../shipping";

type SharePath = "self" | "workshop" | "other";
type ContactMethod = "email" | "phone";
type Stage = "choose" | "form" | "sending" | "success" | "error";

interface Props {
  open: boolean;
  quote: Quote;
  totals: Totals;
  onClose: () => void;
  onCustomerPatch: (updates: Partial<Quote["customer"]>) => void;
  onReset: () => void;
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// Phone: strip everything non-digit, need at least 7 digits.
// Prevents "x" / empty / punctuation-only junk passing the required check.
const phoneDigits = (s: string) => (s ?? "").replace(/\D/g, "");
const isPhone = (s: string) => phoneDigits(s).length >= 7;

const PATHS: {
  id: SharePath;
  title: string;
  sub: string;
  primary?: boolean;
}[] = [
  {
    id: "workshop",
    title: "Send to us",
    sub: "Send this quote to Innate for a personal follow-up. You'll be copied in, and you can optionally CC a partner, designer, or builder too.",
    primary: true,
  },
  {
    id: "self",
    title: "Email it to myself",
    sub: "Just send the quote to my inbox, with a link to reopen it later.",
  },
  {
    id: "other",
    title: "Forward to someone else",
    sub: "Share it with a partner, designer, or builder.",
  },
];

export function QuoteForm({
  open, quote, totals, onClose, onCustomerPatch, onReset,
}: Props) {
  const quoteNo = quote.quoteNo;
  const [stage, setStage] = useState<Stage>("choose");
  const [path, setPath] = useState<SharePath>("workshop");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientNote, setRecipientNote] = useState("");
  // "Send to us" extras: loop in a partner/designer, tell us how to follow up.
  const [additionalEmail, setAdditionalEmail] = useState("");
  const [contactMethod, setContactMethod] = useState<ContactMethod>("email");
  const [bestTimeToCall, setBestTimeToCall] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // Honeypot: bots fill every visible input. We hide this one visually +
  // from assistive tech. Any non-empty value aborts the submit.
  const [honey, setHoney] = useState("");

  const dialog = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLInputElement>(null);

  // Reset when modal re-opens
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStage("choose");
      setPath("workshop");
      setRecipientName("");
      setRecipientEmail("");
      setRecipientNote("");
      setAdditionalEmail("");
      setContactMethod("email");
      setBestTimeToCall("");
      setTouched(false);
      setErrorMsg(null);
      setHoney("");
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
  const phoneOk = isPhone(c.phone ?? "");
  const recipNameOk = recipientName.trim().length > 1;
  const recipEmailOk = isEmail(recipientEmail);
  // Additional-email is always optional; if filled, must be a valid address.
  const addEmailTrim = additionalEmail.trim();
  const addEmailOk = addEmailTrim.length === 0 || isEmail(addEmailTrim);
  const phoneRequiredForContact = path === "workshop" && contactMethod === "phone";

  const canSend = (() => {
    if (!nameOk || !emailOk) return false;
    if (phoneRequiredForContact && !phoneOk) return false;
    if (path === "workshop" && !addEmailOk) return false;
    if (path === "other" && (!recipNameOk || !recipEmailOk)) return false;
    return true;
  })();

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  const submit = async () => {
    setTouched(true);
    if (!canSend) return;
    // Honeypot tripped → silently succeed-look so we don't educate bots.
    if (honey.trim()) {
      setStage("success");
      return;
    }
    setStage("sending");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/send-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          honeypot: honey, // server also rejects non-empty
          customer: {
            name: c.name.trim(),
            email: c.email.trim(),
            phone: c.phone?.trim() || undefined,
            notes: c.notes?.trim() || undefined,
            additionalEmail:
              path === "workshop" && addEmailTrim ? addEmailTrim : undefined,
            contactMethod: path === "workshop" ? contactMethod : undefined,
            bestTimeToCall:
              path === "workshop" && contactMethod === "phone"
                ? bestTimeToCall.trim() || undefined
                : undefined,
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

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="quote-form-h">
      <button type="button" className="modal__scrim" aria-label="Close" onClick={onClose} />
      <div ref={dialog} className="modal__panel" tabIndex={-1}>
        {/* ── STAGE: Choose path ─────────────────────────────── */}
        {stage === "choose" && (
          <>
            <header className="modal__head">
              <h2 id="quote-form-h">Here's your quote</h2>
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
              {PATHS.filter((p) => p.primary).map((p) => (
                <SharePathCard
                  key={p.id}
                  path={p}
                  onClick={() => { setPath(p.id); setStage("form"); }}
                />
              ))}
              <TrustStrip />
              <div className="share-paths__divider" aria-hidden>
                <span>Other ways to share</span>
              </div>
              {PATHS.filter((p) => !p.primary).map((p) => (
                <SharePathCard
                  key={p.id}
                  path={p}
                  onClick={() => { setPath(p.id); setStage("form"); }}
                />
              ))}
            </div>
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
              {/* Honeypot: visually and a11y-hidden. Bots filling every
                  field will fill this one too; humans never see it. */}
              <div aria-hidden style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                <label>
                  Website
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honey}
                    onChange={(e) => setHoney(e.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                <span>Your name</span>
                <input
                  ref={firstField}
                  value={c.name}
                  onChange={(e) => onCustomerPatch({ name: e.target.value })}
                  aria-invalid={touched && !nameOk}
                  autoComplete="name"
                  maxLength={120}
                />
              </label>
              <label className="field">
                <span>
                  Your email
                  {path === "workshop" ? <em> (we'll copy you in)</em> : null}
                </span>
                <input
                  type="email"
                  value={c.email}
                  onChange={(e) => onCustomerPatch({ email: e.target.value })}
                  aria-invalid={touched && !emailOk}
                  autoComplete="email"
                  maxLength={200}
                />
              </label>
              {path === "workshop" && (
                <label className="field">
                  <span>
                    Also CC <em>(optional — partner, designer, builder…)</em>
                  </span>
                  <input
                    type="email"
                    value={additionalEmail}
                    onChange={(e) => setAdditionalEmail(e.target.value)}
                    aria-invalid={touched && !addEmailOk}
                    autoComplete="email"
                    maxLength={200}
                    placeholder="name@example.com"
                  />
                </label>
              )}

              {path === "workshop" ? (
                <fieldset className="preference-group field--wide">
                  <legend>How should we follow up?</legend>
                  <div className="contact-method" role="radiogroup" aria-label="Preferred contact method">
                    <label className={`contact-method__opt${contactMethod === "email" ? " is-on" : ""}`}>
                      <input
                        type="radio"
                        name="contact-method"
                        value="email"
                        checked={contactMethod === "email"}
                        onChange={() => setContactMethod("email")}
                      />
                      <span>Email me back</span>
                    </label>
                    <label className={`contact-method__opt${contactMethod === "phone" ? " is-on" : ""}`}>
                      <input
                        type="radio"
                        name="contact-method"
                        value="phone"
                        checked={contactMethod === "phone"}
                        onChange={() => setContactMethod("phone")}
                      />
                      <span>Give me a call</span>
                    </label>
                  </div>
                  {contactMethod === "phone" && (
                    <div className="preference-group__details">
                      <label className="field">
                        <span>Phone</span>
                        <input
                          type="tel"
                          value={c.phone}
                          onChange={(e) => onCustomerPatch({ phone: e.target.value })}
                          aria-invalid={touched && phoneRequiredForContact && !phoneOk}
                          autoComplete="tel"
                          inputMode="tel"
                          maxLength={30}
                        />
                      </label>
                      <label className="field">
                        <span>Best time to call <em>(optional)</em></span>
                        <input
                          type="text"
                          value={bestTimeToCall}
                          onChange={(e) => setBestTimeToCall(e.target.value)}
                          placeholder="e.g. weekdays after 5pm, or Saturday morning"
                          maxLength={200}
                        />
                      </label>
                    </div>
                  )}
                </fieldset>
              ) : (
                <label className="field">
                  <span>Phone <em>(optional)</em></span>
                  <input
                    type="tel"
                    value={c.phone}
                    onChange={(e) => onCustomerPatch({ phone: e.target.value })}
                    autoComplete="tel"
                    inputMode="tel"
                    maxLength={30}
                  />
                </label>
              )}

              {path === "other" && (
                <>
                  <label className="field">
                    <span>Recipient name</span>
                    <input
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      aria-invalid={touched && !recipNameOk}
                      maxLength={120}
                    />
                  </label>
                  <label className="field">
                    <span>Recipient email</span>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      aria-invalid={touched && !recipEmailOk}
                      maxLength={200}
                    />
                  </label>
                  <label className="field field--wide">
                    <span>Note to {recipientName.split(" ")[0] || "them"} <em>(optional)</em></span>
                    <textarea
                      rows={2}
                      value={recipientNote}
                      onChange={(e) => setRecipientNote(e.target.value)}
                      placeholder="e.g. thinking about this for the kitchen — what do you reckon?"
                      maxLength={1000}
                    />
                  </label>
                </>
              )}

              <label className="field field--wide">
                <span>Anything else we should know? <em>(optional)</em></span>
                <textarea
                  rows={2}
                  value={c.notes}
                  onChange={(e) => onCustomerPatch({ notes: e.target.value })}
                  placeholder={path === "workshop"
                    ? "Install date, site access, finish preferences…"
                    : "Anything you'd like us to know."}
                  maxLength={2000}
                />
              </label>

              {path === "other" && (
                <p className="share-disclose">
                  We'll also send a copy to the workshop for record-keeping — we won't contact you unless you ask.
                </p>
              )}

              {path === "workshop" && (
                <div className="trust-strip trust-strip--form" role="note">
                  <svg className="trust-strip__icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                    <path
                      d="M10 1.8 3 4.4v4.8c0 4 2.8 7.4 7 8.8 4.2-1.4 7-4.8 7-8.8V4.4L10 1.8z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6.8 10.2l2.3 2.3 4.1-4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p>
                    <strong>This is not an order.</strong> No payment is taken. We'll confirm every detail with you before anything is made.
                  </p>
                </div>
              )}

              <div className="quote-form__actions">
                <button type="button" className="btn-ghost" onClick={() => setStage("choose")}>
                  Back
                </button>
                <button type="submit" className="btn-primary" disabled={!canSend || stage === "sending"}>
                  {stage === "sending"
                    ? "Sending…"
                    : path === "workshop"
                      ? "Send it to us"
                      : "Send quote"}
                </button>
              </div>

              {touched && !canSend && (
                <p className="quote-form__err" role="alert">
                  {!nameOk && "Your name is required. "}
                  {!emailOk && "A valid email is required. "}
                  {phoneRequiredForContact && !phoneOk && "A phone number is required when you've asked for a call. "}
                  {path === "workshop" && !addEmailOk && "The extra email address doesn't look valid. "}
                  {path === "other" && !recipNameOk && "Recipient name is required. "}
                  {path === "other" && !recipEmailOk && "Recipient email is required."}
                </p>
              )}

              {stage === "error" && errorMsg && (
                <p className="quote-form__err" role="alert">
                  {errorMsg}. <button type="button" className="btn-ghost" onClick={submit}>Try again</button>
                </p>
              )}
            </form>
          </>
        )}

        {/* ── STAGE: Success ─────────────────────────────────── */}
        {stage === "success" && (
          <div className="quote-success">
            <div className="quote-success__check" aria-hidden>
              <svg viewBox="0 0 40 40" width="38" height="38">
                <circle cx="20" cy="20" r="18.4" fill="none" stroke="#163832" strokeWidth="1.3" />
                <path
                  d="M12.5 20.7l5 5 10.5-11.4"
                  stroke="#163832"
                  strokeWidth="1.8"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h2 className="quote-success__title">
              {path === "self" && "Quote sent to your inbox"}
              {path === "workshop" && "We've got your quote"}
              {path === "other" && `Sent to ${recipientName.split(" ")[0] || "them"}`}
            </h2>
            <p className="quote-success__ref">Quote {quoteNo}</p>
            <p className="quote-success__body">
              {path === "self" &&
                "Check your email — the link reopens this configurator so you can tweak dimensions or delivery any time."}
              {path === "workshop" && (
                <>
                  {addEmailTrim
                    ? `A copy's in your inbox and with ${addEmailTrim}. `
                    : "A copy's in your inbox. "}
                  {contactMethod === "phone"
                    ? bestTimeToCall.trim()
                      ? `We'll give you a call to talk it through — ${bestTimeToCall.trim()}.`
                      : "We'll give you a call to talk it through."
                    : "We'll reply by email to talk it through."}
                </>
              )}
              {path === "other" &&
                "They'll get the full quote and a link to open and explore it. A copy's with us too, so we can pick things up if they ask."}
            </p>
            {path === "workshop" && (
              <p className="quote-success__note">
                This isn't an order. We'll confirm every detail with you before anything is made.
              </p>
            )}
            <div className="quote-success__actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { onReset(); onClose(); }}
              >
                Start a new quote
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={onClose}
              >
                Thanks
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
  const shippingSuffix =
    totals.shipping.cost > 0 ? ` · ${formatNZD(totals.shipping.cost)}` : "";
  return (
    <section className="quote-summary" aria-label="Quote summary">
      <header className="quote-summary__head">
        <span className="quote-summary__eyebrow">Quote summary</span>
        <span className="quote-summary__no">#{quoteNo}</span>
      </header>
      <dl className="quote-summary__rows">
        <div><dt>Timber</dt><dd>{speciesLabel}</dd></div>
        <div><dt>Finish</dt><dd>{quote.finish === "oiled" ? "Sanded & oiled" : "Raw, unsanded"}</dd></div>
        <div><dt>Panels</dt><dd>{quote.panels.length} · {panelSummary(quote)}</dd></div>
        <div><dt>Delivery</dt><dd>{deliveryText}{shippingSuffix}</dd></div>
      </dl>
      <div className="quote-summary__total">
        <div className="quote-summary__total-label">Total incl GST</div>
        <div className="quote-summary__total-amt">{formatNZD(totals.grand)}</div>
        <div className="quote-summary__lead">Ready in ~{totals.leadTimeWeeks} weeks</div>
      </div>
    </section>
  );
}

function SharePathCard({
  path,
  onClick,
}: {
  path: { id: SharePath; title: string; sub: string; primary?: boolean };
  onClick: () => void;
}) {
  const cls =
    "share-path" +
    (path.primary ? " share-path--primary" : " share-path--secondary");
  return (
    <button type="button" className={cls} onClick={onClick}>
      <PathIcon id={path.id} />
      <span className="share-path__text">
        {path.primary && (
          <span className="share-path__eyebrow">The direct line</span>
        )}
        <span className="share-path__title">{path.title}</span>
        <span className="share-path__sub">{path.sub}</span>
      </span>
      <svg viewBox="0 0 16 16" width="12" height="12" className="share-path__arrow" aria-hidden>
        <path d="M5 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function TrustStrip() {
  return (
    <div className="trust-strip" role="note">
      <svg className="trust-strip__icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden>
        <path
          d="M10 1.8 3 4.4v4.8c0 4 2.8 7.4 7 8.8 4.2-1.4 7-4.8 7-8.8V4.4L10 1.8z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M6.8 10.2l2.3 2.3 4.1-4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p>
        <strong>This is not an order.</strong> No payment is taken. We'll confirm every detail with you before anything is made.
      </p>
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
    // A minimal timber slab on steel legs — the product itself, drawn at
    // icon weight. Reads as a table at thumbnail size without feeling
    // literal or logo-like.
    return (
      <svg className="share-path__icon" viewBox="0 0 20 20" width="22" height="22" aria-hidden>
        <rect
          x="2.6" y="6.8" width="14.8" height="2.2" rx=".5"
          fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"
        />
        <path d="M5.4 9v6.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M14.6 9v6.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
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
