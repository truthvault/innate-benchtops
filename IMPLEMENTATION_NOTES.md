# Implementation notes

How this prototype would grow into a real Shopify-mounted Benchtops page, what's mocked today, and what's deliberately out of scope.

## What's real in the prototype

- **Pricing engine** (`src/pricing.ts`). Area × species rate × thickness factor + cutouts + GST + raw discount + minimum-job floor. The maths is the real brief — swap the input numbers via metafields at mount time and it stays correct.
- **Species catalogue** (`mock-data/species.json`). Real Innate species names, provenance, densities and published per-m² rates captured from the current site.
- **Timber photography** (`public/timbers/*.jpg`). Three top-down photos fetched from Innate's public Shopify CDN. Resized and re-encoded locally to ≈350 KB JPEG each.
- **URL-based state** (`src/state.ts`). Share-a-link works: the entire quote is base64url-encoded into the URL hash. Pasting a link reconstructs the configuration.
- **Lead time** (`mock-data/pricing.json`). Sourced from the site-wide banner ("6 weeks turnaround…").

## What's mocked

| Layer | Mock today | Real flow |
|---|---|---|
| Species data | `mock-data/species.json` bundled into JS | Shopify `shop.metafields.innate_benchtop.species` |
| Pricing constants | `mock-data/pricing.json` bundled | Same namespace, `innate_benchtop.pricing` |
| Delivery options | `mock-data/delivery.json` bundled | `innate_benchtop.delivery` |
| Quote submission | 800 ms `setTimeout`, shows success UI | Shopify contact form POST → workshop inbox |
| Quote number | Local hash of a session seed | Issued by the contact-form receiver or an app proxy |
| Lead-time accuracy | Static 6 weeks | Could read from a workshop schedule endpoint |

Everything runs offline. There is no analytics, no cookies beyond `localStorage`, no third-party fetches at runtime (only the one-off photo fetch at setup).

## Shopify mount strategies

There are two reasonable ways to embed the app inside `innate-shopify/`:

### A — Theme section (recommended for MVP)

1. Build the app: `pnpm build`. Output goes to `dist/assets/index-<hash>.{js,css}`.
2. Copy those two files into the theme: `innate-shopify/assets/benchtop-configurator.{js,css}` (strip the hash to stabilise the filename, or keep and template it).
3. Copy `shopify-mock/sections/benchtop-configurator.liquid` into `innate-shopify/sections/`.
4. Copy `shopify-mock/snippets/benchtop-config-data.liquid` into `innate-shopify/snippets/`.
5. Copy `shopify-mock/templates/page.benchtops.json` into `innate-shopify/templates/`.
6. In the Shopify admin: create a page called "Benchtops", set its template to `page.benchtops`.
7. Populate the shop-scoped metafields under namespace `innate_benchtop` (see data contract below). Editors can edit rates from the admin without a redeploy.
8. Wire the client: change `App.tsx` to, on mount, read `document.getElementById("innate-bt-config")`, `JSON.parse()` its text, and pass the result into `species.ts` / `pricing.ts` loaders. If the element is missing, fall back to the bundled mock data (so local dev keeps working).

### B — Custom Shopify app block (longer game)

For richer merchant control (multiple configurator instances per page, non-benchtop products), build a Shopify app that ships a public block. The block reads metafields the same way. This is overkill for a single Benchtops page; keep it in mind if you later want a Tables configurator and a Shelves configurator.

## Data contract — metafields

Under namespace `innate_benchtop`, shop-scoped, all type `json`.

```
shop.metafields.innate_benchtop.species
  [{ id, name, latin, origin, rateNZD, densityKgM3, photo, grain: {…} }, …]

shop.metafields.innate_benchtop.pricing
  { thicknessFactors: {27,40,50}, cutouts: {sink,cooktop},
    rawDiscount, gstRate, minJob, leadTimeWeeks, locale, currency }

shop.metafields.innate_benchtop.delivery
  [{ id, label, detail, price }, …]
```

Structure mirrors `mock-data/*.json`. The `photo` URL can be a Shopify file URL (`{{ 'rimu.jpg' | file_url }}`) or stay on the existing CDN — the client just renders whatever URL it gets.

## Quote handoff options

Ranked cheapest → richest.

1. **Shopify contact form** (MVP). Prepopulate `contact[body]` with a text summary of the quote. Workshop gets an email. No apps required. See `shopify-mock/snippets/benchtop-quote-form.liquid`.
2. **Line-item properties on a placeholder "Custom benchtop" product**. Adds the item to the cart with 30+ `properties[…]` fields so the quote carries through checkout. Only works if you want self-checkout; otherwise it adds friction.
3. **Draft Order via app proxy**. Real end-to-end: the client POSTs to a proxied endpoint (`/apps/innate-benchtop/quote`), a private Shopify app creates a Draft Order, and emails an invoice link. Needs app infrastructure — hosting, secrets, etc.

## What's deliberately out of scope

- **3D preview.** The top-down SVG is intentionally flat — cheaper to render, faster to load, clearer for dimension decisions.
- **Custom shapes.** Only rectangles. Curves, angled corners, peninsula cuts are not supported. If needed later, consider an image-upload "sketch your shape" flow rather than a polygon editor.
- **Stock / availability.** No inventory lookups. The configurator assumes "anything quoted can be built".
- **Exact weight-based shipping.** Delivery is advertised as free nationwide (matches the current Innate policy). If that ever changes, weight is already calculated (`priceLine` returns `weight` in kg) — you'd plug in a courier rate lookup.
- **Bot protection.** A production submission flow needs BotID (Vercel), reCAPTCHA, or Shopify's built-in form throttling. The fake success flow bypasses this.
- **Analytics.** No tracking. Add Shopify's `analytics.publish` or a GA4 event on `request_quote` when the real flow lands.

## Known gaps before shipping for real

1. **Higher-resolution photography** — the current photos are ~1500 px wide, fine for the current 640 px preview pane. For retina + larger displays, shoot or commission 2×–3× top-down photos.
2. **Metafield seed** — create the three metafields in the Shopify admin before the section ships. A sensible first-run would be to copy `mock-data/*.json` straight in.
3. **Copy review** — the microcopy is close to Innate's existing voice but hasn't been edited by Bryan. Worth a pass before launch.
4. **Accessibility audit** — the prototype hits baseline (roles, labels, keyboard traps on modal, `aria-live` on the price). A formal audit should verify colour contrast on the forest/cream buttons at ≥ AA and check reduced-motion behaviour on the slab preview.
5. **Print template** — current print CSS hides interactive UI, but the SlabPreview colour-filter doesn't always survive every browser print engine. A "Download PDF" via `html2pdf.js` is a cheaper, more consistent alternative.
6. **i18n** — copy is English-only. If te reo is a future want, lift the few dozen strings into a locale map (Shopify's `locales/*.json` is the natural home).

## Bundle budget

Target: < 250 KB gzipped JS, < 30 KB gzipped CSS. React 19 + no UI library keeps this easy. If the bundle grows past 350 KB, investigate tree-shaking or pull Offcut into a lazy import.
