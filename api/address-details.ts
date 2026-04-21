/// <reference types="node" />

import type { IncomingMessage, ServerResponse } from "node:http";

// Resolves a Google Place ID to its lat/lng (and formatted address).
// Paired with /api/address-autocomplete via a shared session token so
// Google treats autocomplete → details as one billable session.

interface GoogleDetailsResponse {
  status: string;
  error_message?: string;
  result?: {
    formatted_address?: string;
    geometry?: { location?: { lat: number; lng: number } };
  };
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("content-type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "GET only" }));
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const placeId = url.searchParams.get("place_id") ?? "";
  const session = url.searchParams.get("session") ?? undefined;

  if (!placeId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "place_id required" }));
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "Address lookup not configured" }));
    return;
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: "geometry,formatted_address",
    key: apiKey,
  });
  if (session) params.set("sessiontoken", session);

  try {
    const g = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`,
    );
    const data = (await g.json()) as GoogleDetailsResponse;
    const loc = data.result?.geometry?.location;
    if (data.status !== "OK" || !loc) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          error: data.error_message ?? data.status ?? "Lookup failed",
        }),
      );
      return;
    }
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        lat: loc.lat,
        lng: loc.lng,
        formatted: data.result?.formatted_address ?? "",
      }),
    );
  } catch (e) {
    res.statusCode = 502;
    res.end(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Lookup failed",
      }),
    );
  }
}
