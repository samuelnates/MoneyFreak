// Edge Function: admin-eliminar-usuario
//
// Borra POR COMPLETO la cuenta de OTRO usuario, a petición del dueño de la
// app desde el panel de administración -- mismo alcance exacto que
// eliminar-mi-cuenta (ver _shared/cuenta.ts), pero el que llama no es el
// dueño de los datos, es un admin. Solo se puede invocar con un correo en
// CORREOS_ADMIN (mismo candado que panel-admin-kpis/negocio-movimientos):
// cualquier otra sesión, aunque tenga un JWT válido, recibe 403.
//
// No hay confirmación de dos pasos aquí a propósito -- esa responsabilidad
// vive del lado del cliente (admin.html pide escribir el correo exacto del
// usuario antes de llamar esta función). Este endpoint confía en que quien
// ya pasó el candado de CORREOS_ADMIN sabe lo que está haciendo.

import { createClient } from "npm:@supabase/supabase-js@2";
import { TABLAS_A_BORRAR } from "../_shared/cuenta.ts";

const CORREOS_ADMIN = ["samuelnates@gmail.com"];

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
  const correoAdmin = (userData.user.email || "").toLowerCase();
  if (!CORREOS_ADMIN.includes(correoAdmin)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }
  const objetivoId = body.user_id;
  if (!objetivoId) {
    return jsonResponse({ error: "user_id_requerido" }, 400);
  }
  if (objetivoId === userData.user.id) {
    // El admin quiere borrarse a sí mismo -- eso ya tiene su propio flujo
    // (eliminar-mi-cuenta), no este, para no mezclar los dos casos de uso.
    return jsonResponse({ error: "no_puedes_borrarte_a_ti_mismo" }, 400);
  }

  const { data: objetivoData, error: objetivoError } = await admin.auth.admin.getUserById(objetivoId);
  if (objetivoError || !objetivoData?.user) {
    return jsonResponse({ error: "usuario_no_encontrado" }, 404);
  }
  const correoObjetivo = objetivoData.user.email || null;

  const erroresPorTabla: Record<string, string> = {};
  for (const tabla of TABLAS_A_BORRAR) {
    const { error } = await admin.from(tabla).delete().eq("user_id", objetivoId);
    if (error) {
      console.error(`admin-eliminar-usuario: error borrando ${tabla}:`, error);
      erroresPorTabla[tabla] = error.message;
    }
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(objetivoId);
  if (deleteUserError) {
    console.error("admin-eliminar-usuario: error borrando el usuario de auth:", deleteUserError);
    return jsonResponse({
      error: "delete_user_failed",
      detalle: deleteUserError.message,
      erroresPorTabla,
    }, 500);
  }

  console.log(`admin-eliminar-usuario: ${correoAdmin} borró la cuenta de ${correoObjetivo || objetivoId}`);

  return jsonResponse({
    ok: true,
    correoBorrado: correoObjetivo,
    erroresPorTabla: Object.keys(erroresPorTabla).length ? erroresPorTabla : undefined,
  });
});
