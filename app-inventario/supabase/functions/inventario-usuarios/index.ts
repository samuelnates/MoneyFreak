// Edge Function: inventario-usuarios
//
// Solo editores. Administra las palabras clave de acceso (inv_usuarios_acceso).
// GET    -> lista usuarios (sin exponer el hash de la palabra clave)
// POST   -> crea uno nuevo { nombre, rol: 'viewer'|'editor', palabra_clave }
// PATCH  -> activa/desactiva { id, activo }
//
// No hay "recuperar palabra clave": si se pierde, se desactiva ese usuario
// y se crea uno nuevo. Son credenciales compartidas de bajo riesgo (no
// datos personales de terceros), no cuentas individuales.

import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS_HEADERS, ErrorSesion, jsonResponse, requireSesion, sha256Hex } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  const jwtSecret = Deno.env.get("INVENTARIO_JWT_SECRET");
  if (!jwtSecret) return jsonResponse({ error: "server_misconfigured" }, 500);

  let sesion;
  try {
    sesion = await requireSesion(req, jwtSecret, ["editor"]);
  } catch (e) {
    if (e instanceof ErrorSesion) return jsonResponse({ error: e.message }, e.status);
    throw e;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "GET") {
    const { data, error } = await admin
      .from("inv_usuarios_acceso")
      .select("id, nombre, rol, activo, ultimo_acceso, creado_por, creado_en")
      .order("creado_en", { ascending: false });
    if (error) {
      console.error(error);
      return jsonResponse({ error: "lookup_failed" }, 500);
    }
    return jsonResponse({ usuarios: data });
  }

  if (req.method === "POST") {
    let body: { nombre?: string; rol?: string; palabra_clave?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json_body" }, 400);
    }
    const nombre = (body.nombre || "").trim();
    const rol = body.rol;
    const palabraClave = (body.palabra_clave || "").trim();
    if (!nombre || (rol !== "viewer" && rol !== "editor") || palabraClave.length < 8) {
      return jsonResponse({ error: "invalid_fields", detalle: "nombre, rol (viewer|editor) y palabra_clave (mínimo 8 caracteres) son requeridos" }, 400);
    }
    const hash = await sha256Hex(palabraClave);
    const { data, error } = await admin
      .from("inv_usuarios_acceso")
      .insert({ nombre, rol, palabra_clave_hash: hash, creado_por: sesion.nombre })
      .select("id, nombre, rol, activo, creado_en")
      .single();
    if (error) {
      console.error(error);
      if (error.code === "23505") return jsonResponse({ error: "palabra_clave_en_uso", detalle: "Ya existe otro usuario con esa palabra clave, elige otra." }, 409);
      return jsonResponse({ error: "insert_failed" }, 500);
    }
    await admin.from("inv_auditoria").insert({
      usuario: sesion.nombre,
      rol: sesion.rol,
      accion: "crear_usuario",
      detalle: { nuevo_usuario: nombre, rol: rol },
    });
    return jsonResponse({ usuario: data });
  }

  if (req.method === "PATCH") {
    let body: { id?: string; activo?: boolean };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json_body" }, 400);
    }
    if (!body.id || typeof body.activo !== "boolean") return jsonResponse({ error: "missing_fields" }, 400);
    const { data, error } = await admin
      .from("inv_usuarios_acceso")
      .update({ activo: body.activo })
      .eq("id", body.id)
      .select("id, nombre, rol, activo")
      .maybeSingle();
    if (error) {
      console.error(error);
      return jsonResponse({ error: "update_failed" }, 500);
    }
    if (!data) return jsonResponse({ error: "not_found" }, 404);
    await admin.from("inv_auditoria").insert({
      usuario: sesion.nombre,
      rol: sesion.rol,
      accion: body.activo ? "activar_usuario" : "desactivar_usuario",
      detalle: { usuario_id: body.id, nombre: data.nombre },
    });
    return jsonResponse({ usuario: data });
  }

  return jsonResponse({ error: "method_not_allowed" }, 405);
});
