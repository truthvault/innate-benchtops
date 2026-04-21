#!/usr/bin/env node
// One-shot: fetch three public timber swatch photos from innatefurniture.co.nz's
// Shopify CDN into public/timbers/. No API, no auth — just HTTPS GET on
// public product imagery. Idempotent: skips targets already on disk as JPG
// or PNG. If macOS `sips` is present, resizes + re-encodes to JPEG (≈350 KB);
// otherwise leaves the PNG as fetched.

import { writeFile, stat, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "public", "timbers");

const targets = [
  { slug: "rimu",   url: "https://innatefurniture.co.nz/cdn/shop/files/Rimu_swatch_1.png" },
  { slug: "totara", url: "https://innatefurniture.co.nz/cdn/shop/files/Totara_swatch_finished_2.png" },
  { slug: "beech",  url: "https://innatefurniture.co.nz/cdn/shop/files/Beech_Colour_Swatch_Innate_Furniture.png" },
];

const hasSips = spawnSync("which", ["sips"]).status === 0;
await mkdir(out, { recursive: true });

async function exists(p) {
  try { const s = await stat(p); return s.size > 1024; } catch { return false; }
}

for (const t of targets) {
  const jpg = resolve(out, `${t.slug}.jpg`);
  const png = resolve(out, `${t.slug}.png`);
  if (await exists(jpg) || await exists(png)) {
    console.log(`skip ${t.slug} (already on disk)`);
    continue;
  }
  process.stdout.write(`fetch ${t.slug} … `);
  const res = await fetch(t.url);
  if (!res.ok) {
    console.error(`FAILED ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(png, buf);
  console.log(`${buf.length} bytes png`);

  if (hasSips) {
    process.stdout.write(`  resize+jpeg … `);
    const r1 = spawnSync("sips", ["-Z", "1600", png, "--out", png], { stdio: "ignore" });
    const r2 = spawnSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", png, "--out", jpg], { stdio: "ignore" });
    if (r1.status === 0 && r2.status === 0) {
      await rm(png);
      const s = await stat(jpg);
      console.log(`${s.size} bytes jpg`);
    } else {
      console.log(`sips failed, keeping png`);
    }
  } else {
    console.log(`  (no sips on PATH; keeping png — app also loads .png)`);
  }
}
console.log("done.");
