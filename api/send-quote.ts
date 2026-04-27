/// <reference types="node" />
import { Resend } from "resend";
import { INNATE_LOGO_DATA_URI, INNATE_LOGO_DISPLAY_W, INNATE_LOGO_PX } from "./_lib/innate-logo.js";
import { renderLayoutPng } from "./_lib/layout-image.js";
import { formatDispatchWeek } from "../src/dispatch-date.js";

// ─── Types (narrow copies of client types, kept here to avoid the bundler
//       pulling the whole app into the function) ─────────────────────────

type SharePath = "self" | "workshop" | "other";
type ContactMethod = "email" | "phone";

interface Customer {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  /** Optional CC on the "Send to us" flow — partner, designer, builder, etc. */
  additionalEmail?: string;
  /** "Send to us" only — how the customer prefers we follow up. */
  contactMethod?: ContactMethod;
  /** "Send to us" only, and only relevant when contactMethod === "phone". */
  bestTimeToCall?: string;
}

interface Recipient {
  name: string;
  email: string;
  noteToRecipient?: string;
}

interface PayloadTotals {
  grand: number;
  leadTimeWeeks: number;
  shipping: { cost: number; label: string };
}

interface PayloadPanel {
  length: number;
  width: number;
  thickness: number;
  quantity: number;
  label?: string;
  cutouts: Array<{ widthMm: number; depthMm: number; pos: number; cross: number }>;
}

interface PayloadQuote {
  species: string;
  finish: string;
  panels: PayloadPanel[];
}

interface SendQuotePayload {
  path: SharePath;
  /** Spam honeypot: any non-empty value is treated as bot traffic. */
  honeypot?: string;
  customer: Customer;
  recipient?: Recipient;
  quote: PayloadQuote;
  quoteNo: string;
  totals: PayloadTotals;
  /** The base64-encoded quote hash (the `BASE64` part of `#q=BASE64`).
   *  The full share URL is reconstructed server-side from request
   *  headers — see buildShareUrl(). The client never sends a URL. */
  quoteHash: string;
}

// ─── Minimal in-memory rate limiter (5 req/min/IP) ─────────────────────

const RATE_LIMIT = 5;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function allow(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= RATE_LIMIT) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

// ─── Validation ────────────────────────────────────────────────────────

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const phoneDigits = (s: string) => (s ?? "").replace(/\D/g, "");
const isPhone = (s: string) => phoneDigits(s).length >= 7;

// Length caps — any field over these limits is almost certainly spam or
// accidental paste. Keeps the workshop inbox readable and email-provider
// size limits safe. The quoteHash cap is generous (a 5-panel kitchen with
// 2 cutouts each lands ~1500 chars) so realistic quotes never trip it,
// but tight enough to refuse a 10-MB POST body up front.
const LIMITS = {
  name: 120,
  email: 200,
  phone: 30,
  notes: 2000,
  recipNote: 1000,
  panelLabel: 80,
  quoteNo: 40,
  species: 80,
  shippingLabel: 120,
  quoteHash: 8000,
  bestTimeToCall: 200,
};

function tooLong(s: string | undefined, max: number): boolean {
  return !!s && s.length > max;
}

function validate(payload: SendQuotePayload): string | null {
  if (!payload || typeof payload !== "object") return "Invalid payload";

  // Honeypot: bots fill every field. Any non-empty value = reject silently
  // with a generic error (don't advertise the trap).
  if (typeof payload.honeypot === "string" && payload.honeypot.trim()) {
    return "Invalid submission";
  }

  if (!["self", "workshop", "other"].includes(payload.path)) return "Invalid path";
  if (!payload.customer?.name?.trim()) return "Name required";
  if (tooLong(payload.customer.name, LIMITS.name)) return "Name too long";
  if (!isEmail(payload.customer?.email ?? "")) return "Valid email required";
  if (tooLong(payload.customer.email, LIMITS.email)) return "Email too long";

  if (payload.path === "workshop") {
    const method = payload.customer.contactMethod;
    if (method && method !== "email" && method !== "phone") {
      return "Invalid contact method";
    }
    if (method === "phone" && !isPhone(payload.customer.phone ?? "")) {
      return "A phone number is required when you've asked for a call";
    }
    if (
      payload.customer.additionalEmail &&
      !isEmail(payload.customer.additionalEmail)
    ) {
      return "Additional email is not valid";
    }
    if (tooLong(payload.customer.additionalEmail, LIMITS.email)) {
      return "Additional email too long";
    }
    if (tooLong(payload.customer.bestTimeToCall, LIMITS.bestTimeToCall)) {
      return "Best-time note too long";
    }
  }
  if (tooLong(payload.customer.phone, LIMITS.phone)) return "Phone too long";
  if (tooLong(payload.customer.notes, LIMITS.notes)) return "Notes too long";

  if (payload.path === "other") {
    if (!payload.recipient?.name?.trim()) return "Recipient name required";
    if (tooLong(payload.recipient.name, LIMITS.name)) return "Recipient name too long";
    if (!isEmail(payload.recipient?.email ?? "")) return "Valid recipient email required";
    if (tooLong(payload.recipient.email, LIMITS.email)) return "Recipient email too long";
    if (tooLong(payload.recipient.noteToRecipient, LIMITS.recipNote)) {
      return "Note too long";
    }
  }

  if (!payload.quoteNo?.trim()) return "Missing quote number";
  if (tooLong(payload.quoteNo, LIMITS.quoteNo)) return "Quote number invalid";
  if (!payload.quoteHash?.trim()) return "Missing quote payload";
  if (tooLong(payload.quoteHash, LIMITS.quoteHash)) return "Quote payload too long";
  if (!payload.quote?.panels?.length) return "Missing panel data";
  if (payload.quote.panels.length > 20) return "Too many panels";
  for (const p of payload.quote.panels) {
    if (tooLong(p.label, LIMITS.panelLabel)) return "Panel label too long";
  }
  if (tooLong(payload.quote.species, LIMITS.species)) return "Species invalid";
  if (tooLong(payload.totals?.shipping?.label, LIMITS.shippingLabel)) {
    return "Shipping label invalid";
  }
  return null;
}

// ─── Email body composition ────────────────────────────────────────────

const finishLabel = (f: string) => (f === "oiled" ? "Sanded & oiled" : "Raw");

const nzd = (n: number) =>
  new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  }).format(n);

// Reconstruct the full interactive-quote URL from the request that hit
// this function plus the encoded payload the client sent. Using
// x-forwarded-host means the email link points back to whichever origin
// the customer just submitted from — production custom domain, the
// `*.vercel.app` deployment alias, or a preview deploy — without
// hard-coding any of them. Falls back to the live production URL if the
// header is missing (defensive; Vercel always sets it for serverless).
function buildShareUrl(
  req: { headers: IncomingMessage["headers"] },
  quoteHash: string,
): string {
  const hostHeader = req.headers["x-forwarded-host"] ?? req.headers["host"];
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)
    ?? "innate-benchtop-quote.vercel.app";
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ?? "https";
  return `${proto}://${host}/#q=${quoteHash}`;
}

function panelRows(q: PayloadQuote): string {
  return q.panels
    .map((p, i) => {
      const cutouts = p.cutouts.length
        ? ` · ${p.cutouts.length} cutout${p.cutouts.length > 1 ? "s" : ""}`
        : "";
      return `  ${i + 1}. ${p.label || "Panel"} · ${p.length} × ${p.width} × ${p.thickness} mm · qty ${p.quantity}${cutouts}`;
    })
    .join("\n");
}

export function textBody(payload: SendQuotePayload, shareUrl: string): string {
  const { customer, recipient, quote, quoteNo, totals, path } = payload;
  const dispatchWeek = formatDispatchWeek(new Date(), totals.leadTimeWeeks);
  const finishStep = quote.finish === "oiled"
    ? "Precision milling, laminating, sanding and oiling in our Christchurch workshop."
    : "Precision milling, laminating and sanding in our Christchurch workshop.";
  const lines: string[] = [];

  if (path === "other") {
    lines.push(
      `${customer.name} has shared a benchtop quote with you from Innate Furniture.`,
      recipient?.noteToRecipient ? `\n"${recipient.noteToRecipient}"\n` : "",
      `You can open, explore, and tweak the live quote here:`,
      shareUrl,
      "",
    );
  } else if (path === "self") {
    lines.push(
      `Hi ${customer.name.split(" ")[0] || "there"},`,
      "",
      `Here's your benchtop quote from Innate Furniture. Click the link below to reopen the interactive configurator — adjust dimensions or delivery, and the price updates live.`,
      "",
      shareUrl,
      "",
    );
  } else {
    const prefers =
      customer.contactMethod === "phone"
        ? "PREFERS A CALL"
        : customer.contactMethod === "email"
          ? "PREFERS EMAIL"
          : "";
    lines.push(
      `New benchtop lead from ${customer.name}.`,
      prefers ? `>> ${prefers}${customer.bestTimeToCall ? ` · best time: ${customer.bestTimeToCall}` : ""}` : "",
      "",
      `Customer details:`,
      `  Name: ${customer.name}`,
      `  Email: ${customer.email}`,
      customer.phone ? `  Phone: ${customer.phone}` : "",
      customer.additionalEmail ? `  CC: ${customer.additionalEmail}` : "",
      "",
      customer.notes ? `Notes from customer:\n"${customer.notes}"\n` : "",
      `Interactive quote: ${shareUrl}`,
      "",
    );
  }

  lines.push(
    `Quote ${quoteNo}`,
    `---------------------------------------`,
    `Timber:     ${quote.species}`,
    `Finish:     ${finishLabel(quote.finish)}`,
    `Panels:`,
    panelRows(quote),
    `Delivery:   ${totals.shipping.label}${totals.shipping.cost > 0 ? ` · ${nzd(totals.shipping.cost)}` : ""}`,
    `Dispatch:   Estimated ${dispatchWeek}`,
    `Total:      ${nzd(totals.grand)} incl GST`,
    "",
    `What happens next:`,
    `  1. Confirm and source. We come back to confirm your order, and start sourcing your timber direct from our sawmillers.`,
    `  2. Craft. ${finishStep}`,
    `  3. Dispatch. Wrapped and dispatched. Estimated ${dispatchWeek}.`,
    "",
    `— Innate Furniture · Ōtautahi Christchurch`,
  );

  return lines.filter(Boolean).join("\n");
}

export function htmlBody(payload: SendQuotePayload, shareUrl: string): string {
  const { customer, recipient, quote, quoteNo, totals, path } = payload;
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  const dispatchWeek = formatDispatchWeek(new Date(), totals.leadTimeWeeks);
  const finishStep = quote.finish === "oiled"
    ? "Precision milling, laminating, sanding and oiling in our Christchurch workshop."
    : "Precision milling, laminating and sanding in our Christchurch workshop.";

  // Customer's actual layout, rendered to PNG and inlined as base64.
  // Falls back to null if rendering fails — the panels table below still
  // tells the customer what they're getting, so dropping the image is
  // graceful, not catastrophic.
  const layoutPng = renderLayoutPng(quote.panels);

  const rows = quote.panels
    .map((p, i) => {
      const co = p.cutouts.length
        ? ` · ${p.cutouts.length} cutout${p.cutouts.length > 1 ? "s" : ""}`
        : "";
      return `<tr><td style="padding:4px 8px;color:#14141399">${i + 1}.</td><td style="padding:4px 8px">${esc(p.label || "Panel")} · ${p.length} × ${p.width} × ${p.thickness} mm · qty ${p.quantity}${co}</td></tr>`;
    })
    .join("");

  const intro =
    path === "other"
      ? `<p><strong>${esc(customer.name)}</strong> has shared a benchtop quote with you from Innate Furniture.</p>` +
        (recipient?.noteToRecipient
          ? `<blockquote style="border-left:3px solid #163832;margin:12px 0;padding:6px 12px;color:#14141399;font-style:italic">${esc(recipient.noteToRecipient)}</blockquote>`
          : "")
      : path === "self"
        ? `<p>Hi ${esc(customer.name.split(" ")[0] || "there")},</p><p>Here's your benchtop quote from Innate Furniture. The link below reopens the interactive configurator — adjust dimensions or delivery, and the price updates live.</p>`
        : (() => {
            const prefers =
              customer.contactMethod === "phone"
                ? `<div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#163832;color:#f3f0ee;font-size:12px;font-weight:600;letter-spacing:.02em">Prefers a call${customer.bestTimeToCall ? ` · ${esc(customer.bestTimeToCall)}` : ""}</div>`
                : customer.contactMethod === "email"
                  ? `<div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#163832;color:#f3f0ee;font-size:12px;font-weight:600;letter-spacing:.02em">Prefers email reply</div>`
                  : "";
            const contactLine = [
              esc(customer.email),
              customer.phone ? esc(customer.phone) : "",
              customer.additionalEmail ? `CC: ${esc(customer.additionalEmail)}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              `<p>New benchtop lead from <strong>${esc(customer.name)}</strong>.</p>` +
              (prefers ? `<p style="margin:8px 0">${prefers}</p>` : "") +
              `<p style="color:#14141399;margin:4px 0">${contactLine}</p>` +
              (customer.notes
                ? `<blockquote style="border-left:3px solid #163832;margin:12px 0;padding:6px 12px;color:#14141399;font-style:italic">${esc(customer.notes)}</blockquote>`
                : "")
            );
          })();

  const layoutBlock = layoutPng
    ? `<img src="${layoutPng}" alt="Benchtop layout for quote ${esc(quoteNo)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin:8px 0 4px;border-radius:8px;background:#ffffff">`
    : "";

  // Three-step "what happens next" timeline. Numbered list for max
  // email-client compatibility (Outlook desktop renders custom flexbox
  // unreliably). Each step is a small card with a green index circle.
  const timeline = `
      <div style="margin:24px 0 8px">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#14141399;font-weight:600;margin-bottom:10px">What happens next</div>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5">
          <tr>
            <td style="vertical-align:top;width:30px;padding:8px 12px 8px 0">
              <div style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:999px;background:#163832;color:#f3f0ee;font-weight:600;font-size:12px">1</div>
            </td>
            <td style="vertical-align:top;padding:8px 0">
              <div style="font-weight:600;color:#0c201c">Confirm and source</div>
              <div style="color:#14141399">We come back to confirm your order, and start sourcing your timber direct from our sawmillers.</div>
            </td>
          </tr>
          <tr>
            <td style="vertical-align:top;width:30px;padding:8px 12px 8px 0">
              <div style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:999px;background:#163832;color:#f3f0ee;font-weight:600;font-size:12px">2</div>
            </td>
            <td style="vertical-align:top;padding:8px 0">
              <div style="font-weight:600;color:#0c201c">Craft</div>
              <div style="color:#14141399">${finishStep}</div>
            </td>
          </tr>
          <tr>
            <td style="vertical-align:top;width:30px;padding:8px 12px 8px 0">
              <div style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;border-radius:999px;background:#163832;color:#f3f0ee;font-weight:600;font-size:12px">3</div>
            </td>
            <td style="vertical-align:top;padding:8px 0">
              <div style="font-weight:600;color:#0c201c">Dispatch</div>
              <div style="color:#14141399">Wrapped and dispatched. Estimated ${dispatchWeek}.</div>
            </td>
          </tr>
        </table>
      </div>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Maven Pro',sans-serif;background:#faf8f5;color:#141413;line-height:1.55">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:12px;box-shadow:0 1px 2px rgba(15,15,14,0.06)">
      <img src="${INNATE_LOGO_DATA_URI}" alt="Innate Furniture" width="${INNATE_LOGO_DISPLAY_W}" height="${Math.round(INNATE_LOGO_DISPLAY_W * INNATE_LOGO_PX.h / INNATE_LOGO_PX.w)}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;width:${INNATE_LOGO_DISPLAY_W}px;max-width:100%;margin-bottom:8px">
      <h1 style="margin:4px 0 20px;font-size:20px;font-weight:600">Benchtop quote · ${esc(quoteNo)}</h1>
      ${intro}
      ${layoutBlock}
      <table style="width:100%;border-collapse:collapse;margin:16px 0 8px;font-size:14px">
        <tr><td style="padding:4px 8px;color:#14141399;width:110px">Timber</td><td style="padding:4px 8px">${esc(quote.species)}</td></tr>
        <tr><td style="padding:4px 8px;color:#14141399">Finish</td><td style="padding:4px 8px">${esc(finishLabel(quote.finish))}</td></tr>
        <tr><td style="padding:4px 8px;color:#14141399;vertical-align:top">Panels</td><td style="padding:0"><table style="border-collapse:collapse">${rows}</table></td></tr>
        <tr><td style="padding:4px 8px;color:#14141399">Delivery</td><td style="padding:4px 8px">${esc(totals.shipping.label)}${totals.shipping.cost > 0 ? ` · ${esc(nzd(totals.shipping.cost))}` : ""}</td></tr>
        <tr><td style="padding:4px 8px;color:#14141399">Dispatch</td><td style="padding:4px 8px">Estimated ${esc(dispatchWeek)}</td></tr>
        <tr><td style="padding:12px 8px 4px;color:#14141399;font-weight:600;border-top:1px dashed #e6dfd4">Total</td><td style="padding:12px 8px 4px;border-top:1px dashed #e6dfd4;font-weight:700;color:#0c201c;font-size:18px">${esc(nzd(totals.grand))} <span style="font-weight:400;font-size:12px;color:#14141399">incl GST</span></td></tr>
      </table>
      ${timeline}
      <p style="margin:20px 0 8px">
        <a href="${esc(shareUrl)}" style="display:inline-block;padding:12px 20px;background:#163832;color:#f3f0ee;text-decoration:none;border-radius:6px;font-weight:600">Open interactive quote</a>
      </p>
      <p style="color:#14141399;font-size:12px;margin-top:24px">Innate Furniture · 281 Queen Elizabeth II Drive, Christchurch</p>
    </div>
  </body>
</html>`;
}

// ─── Subject line ──────────────────────────────────────────────────────

function subjectLine(payload: SendQuotePayload): string {
  const { path, quoteNo, quote, customer } = payload;
  const first = quote.panels[0];
  const dim = `${first.length}×${first.width}×${first.thickness}`;
  const species = quote.species;
  switch (path) {
    case "self":
      return `Your benchtop quote · ${quoteNo}`;
    case "workshop":
      return `[ACTION] ${quoteNo} · ${species} ${dim} · ${customer.name}`;
    case "other":
      return `${customer.name} shared a benchtop quote with you · ${quoteNo}`;
  }
}

function workshopSubject(payload: SendQuotePayload): string {
  const { quoteNo, quote, customer } = payload;
  const first = quote.panels[0];
  const dim = `${first.length}×${first.width}×${first.thickness}`;
  const tag = payload.path === "workshop" ? "[ACTION]" : "[FYI]";
  return `${tag} ${quoteNo} · ${quote.species} ${dim} · ${customer.name}`;
}

// ─── Vercel Function handler (classic Node signature) ─────────────────

import type { IncomingMessage, ServerResponse } from "node:http";

interface VercelIncomingMessage extends IncomingMessage {
  /** Vercel's default body-parser parses JSON automatically */
  body?: unknown;
}

function send(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req: VercelIncomingMessage): Promise<SendQuotePayload | null> {
  // Vercel auto-parses application/json, but guard against both parsed
  // and unparsed cases.
  if (req.body && typeof req.body === "object") {
    return req.body as SendQuotePayload;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SendQuotePayload;
  } catch {
    return null;
  }
}

export default async function handler(
  req: VercelIncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    return send(res, 405, { ok: false, error: "POST only" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const fromName = process.env.RESEND_FROM_NAME ?? "Innate Furniture";
  const innate = process.env.INNATE_EMAIL ?? "hello@innatefurniture.co.nz";

  if (!apiKey || !fromEmail) {
    return send(res, 503, { ok: false, error: "Email service not configured" });
  }
  const from = `${fromName} <${fromEmail}>`;

  const fwd = req.headers["x-forwarded-for"];
  const fwdStr = Array.isArray(fwd) ? fwd[0] : fwd;
  const real = req.headers["x-real-ip"];
  const realStr = Array.isArray(real) ? real[0] : real;
  const ip = (fwdStr?.split(",")[0].trim() ?? realStr ?? "unknown") as string;

  if (!allow(ip)) {
    return send(res, 429, { ok: false, error: "Too many requests" });
  }

  const payload = await readJson(req);
  if (!payload) {
    return send(res, 400, { ok: false, error: "Invalid JSON" });
  }

  const err = validate(payload);
  if (err) {
    return send(res, 400, { ok: false, error: err });
  }

  const resend = new Resend(apiKey);
  const shareUrl = buildShareUrl(req, payload.quoteHash);
  const html = htmlBody(payload, shareUrl);
  const text = textBody(payload, shareUrl);

  try {
    const primaryTo =
      payload.path === "self"
        ? payload.customer.email
        : payload.path === "workshop"
          ? innate
          : payload.recipient!.email;

    // On "Send to us", copy the customer (and optional extra address) so
    // they have the quote in their own inbox and can keep the thread alive.
    const cc =
      payload.path === "workshop"
        ? [
            payload.customer.email,
            payload.customer.additionalEmail,
          ].filter((v): v is string => !!v && v !== innate)
        : undefined;

    // Resend's SDK returns Response<T> = { data, error: null } | { data: null, error }
    // — the promise does NOT reject on Resend API errors (rate limits,
    // validation failures, daily quota, content rejections). Until this
    // commit, the handler awaited the call without checking the return,
    // so any Resend error became a silent 200 + ok:true success while
    // no email actually sent. Now we read the discriminator and surface
    // the underlying error.
    const primary = await resend.emails.send({
      from,
      to: [primaryTo],
      cc,
      replyTo: payload.path === "other" ? payload.customer.email : innate,
      subject: subjectLine(payload),
      text,
      html,
    });

    if (primary.error) {
      console.error("send-quote: primary email failed", {
        path: payload.path,
        quoteNo: payload.quoteNo,
        to: primaryTo,
        error: primary.error,
      });
      return send(res, 502, {
        ok: false,
        error: primary.error.message ?? "Email send failed",
      });
    }

    if (payload.path !== "workshop") {
      // Workshop-FYI copy on self/other paths. The customer's primary
      // already succeeded — don't block their success UI on the internal
      // copy. Log so we can reconcile manually if it ever fails.
      const fyi = await resend.emails.send({
        from,
        to: [innate],
        replyTo: payload.customer.email,
        subject: workshopSubject(payload),
        text,
        html,
      });
      if (fyi.error) {
        console.error("send-quote: workshop FYI email failed", {
          path: payload.path,
          quoteNo: payload.quoteNo,
          primaryEmailId: primary.data?.id,
          error: fyi.error,
        });
      }
    }

    return send(res, 200, { ok: true });
  } catch (e) {
    // Catches unexpected throws — network failure, DNS, etc. Resend's
    // own API errors arrive as `Response.error`, not as throws.
    console.error("send-quote: handler threw", e);
    const msg = e instanceof Error ? e.message : "Send failed";
    return send(res, 502, { ok: false, error: msg });
  }
}
