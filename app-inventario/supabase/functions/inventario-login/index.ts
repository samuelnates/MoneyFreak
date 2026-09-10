// Edge Function: inventario-login
//
// Recibe una palabra clave, la compara (por hash) contra inv_usuarios_acceso
// y, si coincide con un usuario activo, devuelve un token firmado con el
// rol (viewer/editor) que el cliente reenvía en cada llamada posterior.
// No hay "usuarios" de Supabase Auth aquí a propósito: el acceso es por
// palabra clave compartida (ej. una para el equipo que solo consulta, otra
// para quien carga los reportes), tal como se pidió.

import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS_HEADERS, firmarSesion, jsonResponse, sha256Hex } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { palabra_clave?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }
  const palabraClave = typeof body.palabra_clave === "string" ? body.palabra_clave.trim() : "";
  if (!palabraClave) return jsonResponse({ error: "missing_palabra_clave" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const jwtSecret = Deno.env.get("INVENTARIO_JWT_SECRET");
  if (!jwtSecret) {
    console.error("Falta configurar el secret INVENTARIO_JWT_SECRET en el proyecto de Supabase.");
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const hash = await sha256Hex(palabraClave);
  const { data: usuario, error } = await admin
    .from("inv_usuarios_acceso")
    .select("id, nombre, rol, activo")
    .eq("palabra_clave_hash", hash)
    .maybeSingle();

  if (error) {
    console.error("Error consultando inv_usuarios_acceso:", error);
    return jsonResponse({ error: "lookup_failed" }, 500);
  }
  if (!usuario || !usuario.activo) {
    return jsonResponse({ error: "palabra_clave_invalida" }, 401);
  }

  const token = await firmarSesion({ sub: usuario.id, nombre: usuario.nombre, rol: usuario.rol }, jwtSecret);

  await admin.from("inv_usuarios_acceso").update({ ultimo_acceso: new Date().toISOString() }).eq("id", usuario.id);
  await admin.from("inv_auditoria").insert({
    usuario: usuario.nombre,
    rol: usuario.rol,
    accion: "login",
    detalle: { user_agent: req.headers.get("user-agent") ?? null },
  });

  return jsonResponse({ token, nombre: usuario.nombre, rol: usuario.rol });
});
