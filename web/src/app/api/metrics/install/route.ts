import { isPwaMetric } from "@/lib/pwa-metrics";

export const runtime = "nodejs";
const MAX_BYTES = 2048;
const headers = { "Cache-Control": "no-store" };

/** Logs JSON del servidor, sin claves Supabase, cookies, ubicación ni direcciones IP. */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin)
    || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Origen no permitido" }, { status: 403, headers });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return Response.json({ error: "Se requiere JSON" }, { status: 415, headers });
  }
  // Límite real de bytes también si Content-Length falta o es falso.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Cuerpo vacío" }, { status: 400, headers });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Cuerpo demasiado grande" }, { status: 413, headers });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isPwaMetric(value)) return Response.json({ error: "Evento inválido" }, { status: 400, headers });
    // Enumerar campos: nunca volcar datos arbitrarios del body ni UA ilimitado.
    console.info(JSON.stringify({
      metric: "biblioradar_pwa", event_id: value.event_id, client_id: value.client_id,
      type: value.type, os: value.os, evidence: value.evidence,
      confirmed_standalone: value.confirmed_standalone, first_open: value.first_open,
      occurred_at: value.occurred_at, timestamp: new Date().toISOString(),
      user_agent: (request.headers.get("user-agent") ?? "").slice(0, 512),
    }));
    return Response.json({ accepted: true }, { status: 202, headers });
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400, headers });
  } finally { reader.releaseLock(); }
}
