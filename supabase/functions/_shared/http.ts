// Shared helpers for Edge Functions. Only web-standard APIs, so the logic is unit-testable in Node.

export function corsHeaders(req: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function json(req: Request, allowedOrigins: string[], status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, allowedOrigins), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const bearer = (req: Request): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "");
  return m ? m[1] : null;
};

export const isEmail = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
