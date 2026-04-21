# shopify-mock/ — future Shopify mount reference

**Nothing in this folder is live.** No build step touches it. It's a reference shape only, written to illustrate one plausible way this prototype could later embed inside `innate-shopify/` as a Dawn-style theme section.

If you want to wire it up properly, treat this as a starting sketch and adapt to whatever Shopify theme architecture you end up using.

## Files

- `sections/benchtop-configurator.liquid` — the page section that mounts the React app. Accepts editor settings (page title, intro copy) and renders a server-side JSON `<script type="application/json">` so the client picks up species rates from Shopify metafields at runtime instead of bundled mock data.
- `snippets/benchtop-config-data.liquid` — emits the JSON config. This is the piece that swaps `mock-data/*.json` for live metafield data.
- `snippets/benchtop-quote-form.liquid` — shows how the "Send to workshop" success flow would become a real `POST /contact` submission using Shopify's built-in contact form handler, with the quote summary wired into `contact[body]`.
- `templates/page.benchtops.json` — a JSON page template that references the section, so a merchant can create a "Benchtops" page and pick this template in the admin.

## Mounting flow (at a glance)

```
build: pnpm build → dist/assets/index-<hash>.{js,css}
                                        │
                                        ▼
copy into theme: innate-shopify/assets/benchtop-configurator.js  (and .css)
                                        │
                                        ▼
section reads metafields → emits JSON   ▼
<script id="innate-bt-config" type="application/json">{ ... }</script>
<div id="innate-benchtop-root"></div>
<script src="{{ 'benchtop-configurator.js' | asset_url }}" defer></script>
```

At runtime, `App.tsx` checks for `#innate-bt-config` first and falls back to the bundled mock-data if it's missing — so dev still works offline.

## Data contract (metafield namespace `innate_benchtop`)

| Metafield | Type | Maps to |
|---|---|---|
| `shop.metafields.innate_benchtop.species` | JSON | `mock-data/species.json` |
| `shop.metafields.innate_benchtop.pricing` | JSON | `mock-data/pricing.json` |
| `shop.metafields.innate_benchtop.delivery` | JSON | `mock-data/delivery.json` |

Edit rates in the Shopify admin (Online Store → Shop → Metafields), and the configurator picks them up on next page load. No redeploy required.

## What this doesn't cover

- Shopify Draft Order API (for real self-checkout) — that needs a private app + an app proxy, out of scope here.
- BotID / reCAPTCHA on the quote submission.
- Responsive image art-direction (`responsive_image` filter).
- Storefront locale JSON (`locales/en.default.json` strings).

See `../IMPLEMENTATION_NOTES.md` for the full integration checklist.
