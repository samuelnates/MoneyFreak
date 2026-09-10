// Edge Function: inventario-alertas
//
// GET  -> lista alertas (viewer y editor). Filtros opcionales: carga_id,
//         periodo_id, resuelta=true|false.
// PATCH -> marca una alerta como resuelta/no resuelta (solo editor).
//          body: { id: uuid, resuelta: boolean }

import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS_HEADERS, ErrorSesion, jsonResponse, requireSesion } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  const jwtSecret = Deno.env.get("INVENTARIO_JWT_SECRET");
  if (!jwtSecret) return jsonResponse({ error: "server_misconfigured" }, 500);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "GET") {
    try {
      await requireSesion(req, jwtSecret);
    } catch (e) {
      if (e instanceof ErrorSesion) return jsonResponse({ error: e.message }, e.status);
      throw e;
    }
    const url = new URL(req.url);
    let q = admin
      .from("inv_alertas")
      .select("*, inv_tiendas(codigo, nombre), inv_marcas(codigo, nombre), inv_periodos(anio, mes, etiqueta)")
      .order("creado_en", { ascending: false });
    const cargaId = url.searchParams.get("carga_id");
    const periodoId = url.searchParams.get("periodo_id");
    const resuelta = url.searchParams.get("resuelta");
    if (cargaId) q = q.eq("carga_id", cargaId);
    if (periodoId) q = q.eq("periodo_id", periodoId);
    if (resuelta !== null) q = q.eq("resuelta", resuelta === "true");
    const { data, error } = await q;
    if (error) {
      console.error(error);
      return jsonResponse({ error: "lookup_failed" }, 500);
    }
    return jsonResponse({ alertas: data });
  }

  if (req.method === "PATCH") {
    let sesion;
    try {
      sesion = await requireSesion(req, jwtSecret, ["editor"]);
    } catch (e) {
      if (e instanceof ErrorSesion) return jsonResponse({ error: e.message }, e.status);
      throw e;
    }
    let body: { id?: string; resuelta?: boolean };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json_body" }, 400);
    }
    if (!body.id || typeof body.resuelta !== "boolean") return jsonResponse({ error: "missing_fields" }, 400);
    const { data, error } = await admin
      .from("inv_alertas")
      .update({
        resuelta: body.resuelta,
        resuelta_por: body.resuelta ? sesion.nombre : null,
        resuelta_en: body.resuelta ? new Date().toISOString() : null,
      })
      .eq("id", body.id)
      .select()
      .maybeSingle();
    if (error) {
      console.error(error);
      return jsonResponse({ error: "update_failed" }, 500);
    }
    if (!data) return jsonResponse({ error: "not_found" }, 404);
    await admin.from("inv_auditoria").insert({
      usuario: sesion.nombre,
      rol: sesion.rol,
      accion: "resolver_alerta",
      detalle: { alerta_id: body.id, resuelta: body.resuelta },
    });
    return jsonResponse({ alerta: data });
  }

  return jsonResponse({ error: "method_not_allowed" }, 405);
});
