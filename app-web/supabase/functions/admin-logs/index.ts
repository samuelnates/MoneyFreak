// Edge Function: admin-logs
//
// Lee los logs REALES de las Edge Functions y de Postgres directo desde el
// panel de administración -- lo mismo que esta sesión de Claude ha estado
// consultando a mano toda la tarde (2026-08-28, ver partes 68/69 de
// CONTEXTO_PROYECTO.md) vía la Management API de Supabase, pero ahora
// disponible para el dueño de la app sin depender de eso.
//
// Requiere el secreto SB_MANAGEMENT_TOKEN (un Personal/Management Access
// Token de Supabase, de la cuenta completa -- Supabase no ofrece uno
// acotado a un solo proyecto). Mismo candado CORREOS_ADMIN que el resto de
// las funciones de admin -- nunca sale del servidor, el navegador jamás lo ve.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORREOS_ADMIN = ["samuelnates@gmail.com"];
const PROJECT_REF = "vtjljpwcyiaaaqbqstvj";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

type FilaLog = { timestamp: number; event_message: string };

async function consultarTabla(mgmtToken: string, tabla: string, sqlWhere: string, desde: string, hasta: string): Promise<FilaLog[]> {
  const params = new URLSearchParams({
    sql: `select timestamp, event_message from ${tabla} ${sqlWhere} order by timestamp desc limit 50`,
    iso_timestamp_start: desde,
    iso_timestamp_end: hasta,
  });
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?${params}`, {
    headers: { Authorization: `Bearer ${mgmtToken}` },
  });
  if (!resp.ok) {
    console.error(`admin-logs: ${tabla} respondió ${resp.status}`);
    return [];
  }
  const cuerpo = await resp.json();
  return (cuerpo.result || []) as FilaLog[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return jsonResponse({ error: "missing_authorization" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "invalid_session" }, 401);
  }
  const correo = (userData.user.email || "").toLowerCase();
  if (!CORREOS_ADMIN.includes(correo)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const mgmtToken = Deno.env.get("SB_MANAGEMENT_TOKEN");
  if (!mgmtToken) {
    return jsonResponse({ error: "management_token_no_configurado" }, 500);
  }

  let body: { minutos?: number; funcion?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const minutos = Math.min(Math.max(Number(body.minutos) || 60, 5), 60 * 24 * 7);
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - minutos * 60 * 1000);
  const desdeIso = desde.toISOString().slice(0, 19) + "Z";
  const hastaIso = hasta.toISOString().slice(0, 19) + "Z";

  const filtroFuncion = body.funcion ? `and event_message like '%${body.funcion.replace(/'/g, "")}%'` : "";

  try {
    const [funcionLogs, funcionErrores, postgresErrores] = await Promise.all([
      consultarTabla(mgmtToken, "function_edge_logs", `where event_message like '%| 4%' or event_message like '%| 5%' ${filtroFuncion}`, desdeIso, hastaIso),
      consultarTabla(mgmtToken, "function_logs", `where (event_message like '%rror%' or event_message like '%Error%') ${filtroFuncion}`, desdeIso, hastaIso),
      consultarTabla(mgmtToken, "postgres_logs", `where event_message like '%ERROR%' or event_message like '%error%'`, desdeIso, hastaIso),
    ]);

    const todos = [
      ...funcionLogs.map((f) => ({ ...f, fuente: "function_edge_logs" })),
      ...funcionErrores.map((f) => ({ ...f, fuente: "function_logs" })),
      ...postgresErrores.map((f) => ({ ...f, fuente: "postgres_logs" })),
    ].sort((a, b) => b.timestamp - a.timestamp);

    return jsonResponse({ ok: true, logs: todos, rangoDesde: desdeIso, rangoHasta: hastaIso });
  } catch (e) {
    console.error("admin-logs: error:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
