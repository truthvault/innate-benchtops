import { Resend } from "resend";

// ─── Types (narrow copies of client types, kept here to avoid the bundler
//       pulling the whole app into the function) ─────────────────────────

type SharePath = "self" | "workshop" | "other";

interface Customer {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
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
  customer: Customer;
  recipient?: Recipient;
  quote: PayloadQuote;
  quoteNo: string;
  totals: PayloadTotals;
  shareUrl: string;
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

function validate(payload: SendQuotePayload): string | null {
  if (!payload || typeof payload !== "object") return "Invalid payload";
  if (!["self", "workshop", "other"].includes(payload.path)) return "Invalid path";
  if (!payload.customer?.name?.trim()) return "Name required";
  if (!isEmail(payload.customer?.email ?? "")) return "Valid email required";
  if (payload.path === "workshop" && !payload.customer.phone?.trim()) {
    return "Phone required for workshop path";
  }
  if (payload.path === "other") {
    if (!payload.recipient?.name?.trim()) return "Recipient name required";
    if (!isEmail(payload.recipient?.email ?? "")) return "Valid recipient email required";
  }
  if (!payload.quoteNo?.trim()) return "Missing quote number";
  if (!payload.shareUrl?.trim()) return "Missing share URL";
  if (!payload.quote?.panels?.length) return "Missing panel data";
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

function textBody(payload: SendQuotePayload): string {
  const { customer, recipient, quote, quoteNo, totals, shareUrl, path } = payload;
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
    lines.push(
      `New benchtop lead from ${customer.name}.`,
      "",
      `Customer details:`,
      `  Name: ${customer.name}`,
      `  Email: ${customer.email}`,
      customer.phone ? `  Phone: ${customer.phone}` : "",
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
    `Lead time:  ~${totals.leadTimeWeeks} weeks`,
    `Total:      ${nzd(totals.grand)} incl GST`,
    "",
    `— Innate Furniture · Ōtautahi Christchurch`,
  );

  return lines.filter(Boolean).join("\n");
}

function htmlBody(payload: SendQuotePayload): string {
  const { customer, recipient, quote, quoteNo, totals, shareUrl, path } = payload;
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
        : `<p>New benchtop lead from <strong>${esc(customer.name)}</strong>.</p>` +
          `<p style="color:#14141399;margin:4px 0">${esc(customer.email)}${customer.phone ? ` · ${esc(customer.phone)}` : ""}</p>` +
          (customer.notes
            ? `<blockquote style="border-left:3px solid #163832;margin:12px 0;padding:6px 12px;color:#14141399;font-style:italic">${esc(customer.notes)}</blockquote>`
            : "");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Maven Pro',sans-serif;background:#faf8f5;color:#141413;line-height:1.55">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:12px;box-shadow:0 1px 2px rgba(15,15,14,0.06)">
      <div style="letter-spacing:.18em;color:#163832;font-weight:700;font-size:13px">INNATE</div>
      <h1 style="margin:4px 0 20px;font-size:20px;font-weight:600">Benchtop quote · ${esc(quoteNo)}</h1>
      ${intro}
      <p style="margin:16px 0 8px">
        <a href="${esc(shareUrl)}" style="display:inline-block;padding:12px 20px;background:#163832;color:#f3f0ee;text-decoration:none;border-radius:6px;font-weight:600">Open interactive quote</a>
      </p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px">
        <tr><td style="padding:4px 8px;color:#14141399;width:110px">Timber</td><td style="padding:4px 8px">${esc(quote.species)}</td></tr>
        <tr><td style="padding:4px 8px;color:#14141399">Finish</td><td style="padding:4px 8px">${esc(finishLabel(quote.finish))}</td></tr>
        <tr><td style="padding:4px 8px;color:#14141399;vertical-align:top">Panels</td><td style="padding:0"><table style="border-collapse:collapse">${rows}</table></td></tr>
        <tr><td style="padding:4px 8px;color:#14141399">Delivery</td><td style="padding:4px 8px">${esc(totals.shipping.label)}${totals.shipping.cost > 0 ? ` · ${esc(nzd(totals.shipping.cost))}` : ""}</td></tr>
        <tr><td style="padding:4px 8px;color:#14141399">Lead time</td><td style="padding:4px 8px">~${totals.leadTimeWeeks} weeks</td></tr>
        <tr><td style="padding:12px 8px 4px;color:#14141399;font-weight:600;border-top:1px dashed #e6dfd4">Total</td><td style="padding:12px 8px 4px;border-top:1px dashed #e6dfd4;font-weight:700;color:#0c201c;font-size:18px">${esc(nzd(totals.grand))} <span style="font-weight:400;font-size:12px;color:#14141399">incl GST</span></td></tr>
      </table>
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

// ─── Vercel Function handler ───────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS;
  const innate = process.env.INNATE_INBOX ?? "hello@innatefurniture.co.nz";

  if (!apiKey || !from) {
    return new Response(
      JSON.stringify({ ok: false, error: "Email service not configured" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!allow(ip)) {
    return new Response(JSON.stringify({ ok: false, error: "Too many requests" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  let payload: SendQuotePayload;
  try {
    payload = (await req.json()) as SendQuotePayload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const err = validate(payload);
  if (err) {
    return new Response(JSON.stringify({ ok: false, error: err }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const resend = new Resend(apiKey);

  const html = htmlBody(payload);
  const text = textBody(payload);

  try {
    // ── Primary recipient ──────────────────────────────────────────
    const primaryTo =
      payload.path === "self"
        ? payload.customer.email
        : payload.path === "workshop"
          ? innate
          : payload.recipient!.email;

    await resend.emails.send({
      from,
      to: [primaryTo],
      replyTo: payload.path === "other" ? payload.customer.email : innate,
      subject: subjectLine(payload),
      text,
      html,
    });

    // ── Always cc the workshop (except when workshop IS the primary,
    //    because then it already got the email above) ──────────────
    if (payload.path !== "workshop") {
      await resend.emails.send({
        from,
        to: [innate],
        replyTo: payload.customer.email,
        subject: workshopSubject(payload),
        text,
        html,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
