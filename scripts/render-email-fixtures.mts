import { writeFileSync, mkdirSync } from "node:fs";
import { textBody, htmlBody } from "../api/send-quote.ts";
import { renderLayoutPng } from "../api/_lib/layout-image.ts";
import { INNATE_LOGO_DATA_URI } from "../api/_lib/innate-logo.ts";
import { formatDispatchWeek } from "../src/dispatch-date.ts";

mkdirSync("/tmp/email-fixtures", { recursive: true });

const baseCustomer = {
  name: "Test Customer",
  email: "test@example.com",
  phone: "0211234567",
};
const baseTotals = {
  grand: 1749,
  leadTimeWeeks: 6,
  shipping: { cost: 0, label: "Pick up · free" },
};

const shapes = [
  {
    key: "T1_single",
    grand: 1749,
    panels: [{ length: 2400, width: 650, thickness: 33, quantity: 1, label: "Main run", cutouts: [] }],
  },
  {
    key: "V2_kitchen",
    grand: 4581,
    panels: [
      {
        length: 2400, width: 650, thickness: 33, quantity: 1, label: "Main run",
        cutouts: [
          { widthMm: 700, depthMm: 495, pos: 0.35, cross: 0.5 },
          { widthMm: 750, depthMm: 440, pos: 0.78, cross: 0.5 },
        ],
      },
      { length: 1800, width: 900, thickness: 33, quantity: 1, label: "Island", cutouts: [] },
    ],
  },
  {
    key: "V3_five",
    grand: 13923,
    panels: Array.from({ length: 5 }, (_, i) => ({
      length: 2400, width: 650, thickness: 33, quantity: 1,
      label: i === 0 ? "Main run" : `Panel ${i + 1}`,
      cutouts: [
        { widthMm: 700, depthMm: 495, pos: 0.35, cross: 0.5 },
        { widthMm: 750, depthMm: 440, pos: 0.78, cross: 0.5 },
      ],
    })),
  },
];

console.log("=== Layout PNG sizes ===");
for (const s of shapes) {
  const png = renderLayoutPng(s.panels);
  if (!png) {
    console.log(`✗ ${s.key} — render returned null`);
    continue;
  }
  const b64 = png.replace(/^data:image\/png;base64,/, "");
  const pngBytes = Buffer.from(b64, "base64").length;
  const cutCount = s.panels.reduce((a, p) => a + p.cutouts.length, 0);
  console.log(`  ${s.key}: PNG=${(pngBytes/1024).toFixed(1)}KB  base64=${(b64.length/1024).toFixed(1)}KB  (${s.panels.length} panels, ${cutCount} cutouts)`);
  writeFileSync(`/tmp/email-fixtures/layout-${s.key}.png`, Buffer.from(b64, "base64"));
}

const logoB64 = INNATE_LOGO_DATA_URI.replace(/^data:image\/png;base64,/, "");
console.log(`  logo:       PNG=${(Buffer.from(logoB64,"base64").length/1024).toFixed(1)}KB  base64=${(logoB64.length/1024).toFixed(1)}KB`);

console.log("\n=== Dispatch dates ===");
const today = new Date();
for (const w of [4, 5, 6, 8]) {
  console.log(`  today + ${w}w → "${formatDispatchWeek(today, w)}"`);
}

console.log("\n=== Full email sizes ===");
const SHARE_URL = "https://innate-benchtop-quote.vercel.app/#q=eyJwYW5lbHMiOlt7ImlkIjoiYSJ9XSwic3BlY2llcyI6InJpbXUifQ";
for (const s of shapes) {
  for (const path of ["self", "workshop", "other"] as const) {
    const payload = {
      path,
      customer: baseCustomer,
      recipient: path === "other" ? { name: "Friend", email: "friend@example.com" } : undefined,
      quote: { species: "West Coast Rimu", finish: "oiled", panels: s.panels },
      quoteNo: "INT-666",
      totals: { ...baseTotals, grand: s.grand },
      quoteHash: "TEST_HASH",
    };
    const html = htmlBody(payload as any, SHARE_URL);
    const text = textBody(payload as any, SHARE_URL);
    const htmlKB = (Buffer.byteLength(html) / 1024).toFixed(1);
    const textKB = (Buffer.byteLength(text) / 1024).toFixed(1);
    writeFileSync(`/tmp/email-fixtures/${s.key}-${path}.html`, html);
    writeFileSync(`/tmp/email-fixtures/${s.key}-${path}.txt`, text);
    console.log(`  ${s.key} / ${path}: HTML=${htmlKB}KB  text=${textKB}KB`);
  }
}

console.log("\nFixtures written to /tmp/email-fixtures/");
