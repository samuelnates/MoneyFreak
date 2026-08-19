// Edge Function: canjear-codigo-ia
//
// Canjea un código de acceso para desbloquear la radiografía financiera
// automática (la que llama a OpenAI). Un usuario que ya canjeó un código
// simplemente queda con acceso permanente (fila en accesos_ia_usuarios);
// no hay expiración por ahora.

import { createClient } from "npm:@supabase/supabase-js@2";

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
  const userId = userData.user.id;

  let body: { codigo?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }
  const codigo = typeof body.codigo === "string" ? body.codigo.trim() : "";
  if (!codigo) {
    return jsonResponse({ error: "missing_codigo" }, 400);
  }

  // Si ya tiene acceso, no hay nada que hacer (evita canjear dos veces / doble conteo).
  const { data: yaTiene, error: yaTieneError } = await admin
    .from("accesos_ia_usuarios")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (yaTieneError) {
    console.error("Error verificando acceso previo:", yaTieneError);
    return jsonResponse({ error: "lookup_failed" }, 500);
  }
  if (yaTiene) {
    return jsonResponse({ ok: true, ya_tenia_acceso: true });
  }

  const { data: codigoData, error: codigoError } = await admin
    .from("codigos_acceso_ia")
    .select("*")
    .eq("codigo", codigo)
    .maybeSingle();
  if (codigoError) {
    console.error("Error consultando código:", codigoError);
    return jsonResponse({ error: "lookup_failed" }, 500);
  }
  if (!codigoData || !codigoData.activo) {
    return jsonResponse({ error: "codigo_invalido" }, 403);
  }
  if (codigoData.usos_maximos != null && codigoData.usos_actuales >= codigoData.usos_maximos) {
    return jsonResponse({ error: "codigo_agotado" }, 403);
  }

  const { error: insertError } = await admin
    .from("accesos_ia_usuarios")
    .insert({ user_id: userId, codigo: codigoData.codigo });
  if (insertError) {
    console.error("Error guardando acceso:", insertError);
    return jsonResponse({ error: "redeem_failed" }, 500);
  }

  await admin
    .from("codigos_acceso_ia")
    .update({ usos_actuales: codigoData.usos_actuales + 1 })
    .eq("codigo", codigoData.codigo);

  return jsonResponse({ ok: true });
});
