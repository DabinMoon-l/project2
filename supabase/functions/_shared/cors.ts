// CORS 공통 헤더 — Edge Functions 에서 프론트(Vercel) 직접 호출용
// 프론트 origin 은 NEXT_PUBLIC_APP_URL 과 일치시킨다.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
