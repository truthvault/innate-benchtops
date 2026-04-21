/// <reference types="node" />

import type { IncomingMessage, ServerResponse } from "node:http";

// Returns the approximate lat/lng for the caller based on Vercel's
// edge geolocation headers (set automatically on every request by
// the Vercel Edge Network). No external API calls, no client-side
// permission prompts, works on any desktop network.

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const h = req.headers;
  const latStr = h["x-vercel-ip-latitude"];
  const lngStr = h["x-vercel-ip-longitude"];
  const city = h["x-vercel-ip-city"];
  const country = h["x-vercel-ip-country"];
  const region = h["x-vercel-ip-country-region"];

  const lat = parseFloat(
    Array.isArray(latStr) ? latStr[0] : (latStr as string) ?? "",
  );
  const lng = parseFloat(
    Array.isArray(lngStr) ? lngStr[0] : (lngStr as string) ?? "",
  );

  res.setHeader("content-type", "application/json");

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.statusCode = 503;
    res.end(
      JSON.stringify({
        ok: false,
        error: "Location headers unavailable on this request.",
      }),
    );
    return;
  }

  // City / region names come URL-encoded on Vercel headers. Decode safely.
  const decode = (v: string | string[] | undefined): string | undefined => {
    if (!v) return undefined;
    const s = Array.isArray(v) ? v[0] : v;
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      ok: true,
      lat,
      lng,
      city: decode(city),
      region: decode(region),
      country: decode(country),
    }),
  );
}
