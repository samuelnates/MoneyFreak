// Edge Function: admin-usuarios
//
// Acciones de soporte sobre la cuenta de OTRO usuario, a petición del dueño
// de la app desde el panel de administración -- mismo candado que
// panel-admin-kpis/negocio-movimientos/admin-eliminar-usuario (CORREOS_ADMIN).
// A diferencia de admin-eliminar-usuario, estas 3 acciones son reversibles
// (o al menos no destruyen datos financieros):
//
// - banear / desbanear: bloquea o desbloquea el login sin tocar ni un solo
//   dato -- para soporte/abuso cuando no se está seguro de querer borrar.
// - editar_correo: corrige un correo mal escrito sin que el usuario tenga
//   que reconfirmarlo (el admin ya sabe que es el correo correcto).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORREOS_ADMIN = ["samuelnates@gmail.com"];

// GoTrue no tiene un "ban permanente" real, solo una duración -- 100 años es
// el idiom estándar que usa la propia documentación de Supabase para esto.
const DURACION_BAN_PERMANENTE = "876000h";

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

function esCorreoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
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

  let body: { accion?: string; user_id?: string; correo_nuevo?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }
  const objetivoId = body.user_id;
  if (!objetivoId) {
    return jsonResponse({ error: "user_id_requerido" }, 400);
  }

  try {
    if (body.accion === "banear") {
      if (objetivoId === userData.user.id) {
        return jsonResponse({ error: "no_puedes_suspenderte_a_ti_mismo" }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(objetivoId, { ban_duration: DURACION_BAN_PERMANENTE });
      if (error) return jsonResponse({ error: "ban_failed", detalle: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    if (body.accion === "desbanear") {
      const { error } = await admin.auth.admin.updateUserById(objetivoId, { ban_duration: "none" });
      if (error) return jsonResponse({ error: "unban_failed", detalle: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    if (body.accion === "editar_correo") {
      const nuevoCorreo = (body.correo_nuevo || "").trim().toLowerCase();
      if (!esCorreoValido(nuevoCorreo)) {
        return jsonResponse({ error: "correo_invalido" }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(objetivoId, { email: nuevoCorreo, email_confirm: true });
      if (error) return jsonResponse({ error: "editar_correo_failed", detalle: error.message }, 500);
      return jsonResponse({ ok: true, correoNuevo: nuevoCorreo });
    }

    return jsonResponse({ error: "accion_desconocida" }, 400);
  } catch (e) {
    console.error("admin-usuarios: error:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
