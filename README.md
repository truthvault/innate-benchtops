# Innate Benchtops — local prototype

A local, single-page configurator prototype for Innate Furniture's Benchtops page. Choose timber, set dimensions, toggle finish, add sink/cooktop cutouts, see the price and lead time update live, submit a (fake) quote request.

No backend. No Shopify connection. No deployment. Everything runs from your machine.

## Run it

Requires Node 18+ and `pnpm` (or `npm`).

```bash
pnpm install
pnpm fetch-photos     # one-off: downloads 3 timber photos from innate's public CDN
pnpm dev              # http://localhost:5173
```

That's it. Hot reload is live; edits in `src/` appear immediately in the browser.

### Other useful commands

```bash
pnpm build            # produces dist/ — static, ready to host anywhere
pnpm preview          # serve the built bundle locally
pnpm lint             # eslint
```

## What's in the box

| Feature                                       | Status           |
|-----------------------------------------------|------------------|
| Add / remove rectangular panels               | ✅                |
| Length / width / thickness / quantity         | ✅ per panel      |
| Three timber species (Rimu, Tōtara, Beech)    | ✅ photo tiles    |
| Finish: sanded & oiled vs raw (−10%)          | ✅                |
| Sink cutouts — count per panel                | ✅ 0–3            |
| Cooktop cutouts — count per panel             | ✅ 0–2            |
| Delivery: pickup / nationwide (free)          | ✅                |
| Live slab preview (top-down, to scale)        | ✅ SVG + photos   |
| Sticky bottom price bar, incl GST + lead time | ✅                |
| URL-based state — share a link, keep config   | ✅ `#q=…` hash    |
| localStorage persistence                      | ✅                |
| Quote form + fake success state               | ✅ no network     |
| Print / PDF from browser                      | ✅ clean layout   |
| Mobile-first layout                           | ✅ 375 px up      |

## What's mocked

Everything. The app never calls an API. Pricing, species, delivery options, lead time and quote numbers all come from `mock-data/*.json`. The "Send to workshop" button simulates an 800 ms round-trip, then flips to a success state — no email is sent, no data leaves the browser.

See [`IMPLEMENTATION_NOTES.md`](./IMPLEMENTATION_NOTES.md) for what would change when wiring this into Shopify.

## Project layout

```
.
├── mock-data/         # species, pricing, delivery — the only data source at runtime
├── public/
│   └── timbers/       # 3 top-down photos (fetched by scripts/fetch-timber-photos.mjs)
├── scripts/
│   └── fetch-timber-photos.mjs
├── shopify-mock/      # reference files for a future theme mount (not wired)
├── src/
│   ├── App.tsx
│   ├── components/    # SlabPreview, PanelEditor, TimberPicker, FinishToggle,
│   │                  # DeliveryPicker, StickyBar, QuoteForm, Offcut
│   ├── species.ts     # loads from mock-data/*.json
│   ├── pricing.ts     # pure functions
│   ├── state.ts       # URL-hash + localStorage encoder
│   └── styles.css
├── IMPLEMENTATION_NOTES.md
└── README.md
```

## Troubleshooting

**Photos don't appear.** Re-run `pnpm fetch-photos`. If you're offline, the app silently falls back to procedural SVG grain rendering (the `Offcut` component) — it's hidden by default but you can see it by deleting `public/timbers/*` and editing `styles.css` to unhide `.slab-preview__fallback`.

**Port 5173 is in use.** `pnpm dev -- --port 5200` or similar.

**URL is very long.** That's the `#q=…` encoded state. It's intentional — anyone pasting the URL sees the exact same configuration.

**`pnpm fetch-photos` fails behind a strict firewall.** The script just does plain HTTPS GETs to `https://innatefurniture.co.nz/cdn/shop/files/…`. If your network can't reach that, drop any 3 top-down JPGs into `public/timbers/` named `rimu.jpg`, `totara.jpg`, `beech.jpg` and the app will use them.

## Scope note

This is a sandboxed prototype. It does not push anywhere, connect to Shopify, use production credentials, or touch files outside this folder. `shopify-mock/` contains illustrative `.liquid` / `.json` files explaining how a future Shopify section *could* consume this app — those files are not executed by anything in this repo.
