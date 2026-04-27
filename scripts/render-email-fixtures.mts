import { writeFileSync, mkdirSync } from "node:fs";
import { textBody, htmlBody } from "../api/send-quote.ts";
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

console.log("=== Dispatch dates ===");
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

// Sanity-check the greeting fallback by rendering the "self" path with
// each sample name and grepping the rendered HTML for the greeting line.
console.log("\n=== Greeting first-name extraction ===");
const greetingNames = ["Guido", "Final V2 polished", "Dr Sarah Smith", ""];
for (const name of greetingNames) {
  const payload = {
    path: "self" as const,
    customer: { name, email: "test@example.com", phone: "0211234567" },
    quote: { species: "West Coast Rimu", finish: "oiled", panels: shapes[0].panels },
    quoteNo: "INT-666",
    totals: baseTotals,
    quoteHash: "TEST_HASH",
  };
  const html = htmlBody(payload as any, SHARE_URL);
  const match = html.match(/<p>Hi ([^,]+),<\/p>/);
  const greeting = match ? `Hi ${match[1]}` : "(no greeting found)";
  console.log(`  name="${name}" → "${greeting}"`);
}

// Verify the logo <img> references the hosted Shopify URL and there's no
// inline data: URI left over from Prompt 8.
console.log("\n=== Image src audit ===");
{
  const html = htmlBody({
    path: "self", customer: baseCustomer, quote: { species: "Rimu", finish: "oiled", panels: shapes[0].panels },
    quoteNo: "INT-666", totals: baseTotals, quoteHash: "T",
  } as any, SHARE_URL);
  const imgs = [...html.matchAll(/<img\s[^>]*src="([^"]+)"/g)].map(m => m[1]);
  console.log(`  ${imgs.length} <img> tag(s):`);
  for (const src of imgs) {
    const summary = src.startsWith("data:") ? "INLINE BASE64 (BAD)" : src;
    console.log(`    - ${summary}`);
  }
  const inlineCount = imgs.filter(s => s.startsWith("data:")).length;
  console.log(`  Inline base64 count: ${inlineCount} ${inlineCount === 0 ? "✓" : "✗"}`);
}

console.log("\nFixtures written to /tmp/email-fixtures/");
