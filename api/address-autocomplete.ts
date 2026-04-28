/// <reference types="node" />

import type { IncomingMessage, ServerResponse } from "node:http";

// Proxies Google Places Autocomplete from the server so the API key
// stays private. Restricted to NZ addresses.

const ALLOWED_ORIGINS = new Set([
  "https://innatefurniture.co.nz",
  "https://innate-furniture.myshopify.com",
]);

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

interface GooglePrediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
}

interface GoogleResponse {
  status: string;
  error_message?: string;
  predictions?: GooglePrediction[];
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  res.setHeader("content-type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "GET only" }));
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const q = (url.searchParams.get("q") ?? "").trim();
  const session = url.searchParams.get("session") ?? undefined;

  if (q.length < 3) {
    res.statusCode = 200;
    res.end(JSON.stringify({ predictions: [] }));
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "Address search not configured" }));
    return;
  }

  const params = new URLSearchParams({
    input: q,
    components: "country:nz",
    key: apiKey,
    types: "geocode",
  });
  if (session) params.set("sessiontoken", session);

  try {
    const g = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`,
    );
    const data = (await g.json()) as GoogleResponse;

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          error: data.error_message ?? data.status ?? "Autocomplete failed",
        }),
      );
      return;
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        predictions: (data.predictions ?? []).map((p) => ({
          id: p.place_id,
          text: p.description,
          mainText: p.structured_formatting?.main_text ?? p.description,
          secondaryText: p.structured_formatting?.secondary_text ?? "",
        })),
      }),
    );
  } catch (e) {
    res.statusCode = 502;
    res.end(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Autocomplete failed",
      }),
    );
  }
}
