// Edge Function: inventario-datos
//
// Endpoint de lectura para el dashboard e histórico. Disponible para
// viewer y editor (de solo lectura). Todo se controla con el query param
// `vista`:
//   ?vista=catalogo           -> marcas, tiendas y periodos disponibles (para llenar filtros)
//   ?vista=metricas&...       -> filas de inv_metricas_tienda con filtros
//   ?vista=historico_marca    -> serie mensual a nivel marca (incluye backfill + agregado de cargas)
//   ?vista=cedis_transito&... -> filas de inv_cedis_transito con filtros
//   ?vista=alertas&...        -> alertas (delegable a inventario-alertas, se deja aquí también por conveniencia de lectura)
//
// Filtros comunes (todos opcionales, se combinan con AND):
//   marca=<id o código, coma-separado>   tienda=<id, coma-separado>
//   periodo_desde=AAAA-MM  periodo_hasta=AAAA-MM

import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS_HEADERS, ErrorSesion, jsonResponse, requireSesion } from "../_shared/auth.ts";

function primerDiaDeMes(aaaaMm: string): string | null {
  const m = aaaaMm.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-01`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);

  const jwtSecret = Deno.env.get("INVENTARIO_JWT_SECRET");
  if (!jwtSecret) return jsonResponse({ error: "server_misconfigured" }, 500);

  try {
    await requireSesion(req, jwtSecret); // viewer o editor, cualquiera puede leer
  } catch (e) {
    if (e instanceof ErrorSesion) return jsonResponse({ error: e.message }, e.status);
    throw e;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const url = new URL(req.url);
  const vista = url.searchParams.get("vista") || "catalogo";
  const marcaParam = url.searchParams.get("marca");
  const tiendaParam = url.searchParams.get("tienda");
  const periodoDesde = url.searchParams.get("periodo_desde");
  const periodoHasta = url.searchParams.get("periodo_hasta");

  if (vista === "catalogo") {
    const [marcas, tiendas, periodos] = await Promise.all([
      admin.from("inv_marcas").select("id, codigo, nombre, orden, activo").order("orden"),
      admin.from("inv_tiendas").select("id, marca_id, canal, codigo, nombre, activo").order("codigo"),
      admin.from("inv_periodos").select("id, anio, mes, etiqueta, fecha").order("fecha"),
    ]);
    if (marcas.error || tiendas.error || periodos.error) {
      console.error(marcas.error, tiendas.error, periodos.error);
      return jsonResponse({ error: "lookup_failed" }, 500);
    }
    return jsonResponse({ marcas: marcas.data, tiendas: tiendas.data, periodos: periodos.data });
  }

  if (vista === "metricas") {
    // Filtrar por rango de periodo requiere resolver primero los ids de
    // inv_periodos: PostgREST no filtra de forma confiable sobre una tabla
    // embebida sin !inner, y aquí es más simple resolverlo en dos pasos.
    let periodoIds: string[] | null = null;
    if (periodoDesde || periodoHasta) {
      let pq = admin.from("inv_periodos").select("id");
      const f = periodoDesde ? primerDiaDeMes(periodoDesde) : null;
      const h = periodoHasta ? primerDiaDeMes(periodoHasta) : null;
      if (f) pq = pq.gte("fecha", f);
      if (h) pq = pq.lte("fecha", h);
      const { data: periodosEnRango, error: errPeriodos } = await pq;
      if (errPeriodos) {
        console.error(errPeriodos);
        return jsonResponse({ error: "lookup_failed" }, 500);
      }
      periodoIds = (periodosEnRango || []).map((p) => p.id);
      if (periodoIds.length === 0) return jsonResponse({ filas: [] });
    }

    let q = admin
      .from("inv_metricas_tienda")
      .select(
        "*, inv_tiendas(codigo, nombre, canal), inv_marcas(codigo, nombre), inv_periodos(anio, mes, etiqueta, fecha)",
      );
    if (marcaParam) q = q.in("marca_id", marcaParam.split(","));
    if (tiendaParam) q = q.in("tienda_id", tiendaParam.split(","));
    if (periodoIds) q = q.in("periodo_id", periodoIds);
    const { data, error } = await q;
    if (error) {
      console.error(error);
      return jsonResponse({ error: "lookup_failed" }, 500);
    }
    return jsonResponse({ filas: data });
  }

  if (vista === "cedis_transito") {
    let q = admin
      .from("inv_cedis_transito")
      .select("*, inv_marcas(codigo, nombre), inv_periodos(anio, mes, etiqueta, fecha)");
    if (marcaParam) q = q.in("marca_id", marcaParam.split(","));
    const { data, error } = await q;
    if (error) {
      console.error(error);
      return jsonResponse({ error: "lookup_failed" }, 500);
    }
    return jsonResponse({ filas: data });
  }

  if (vista === "historico_marca") {
    let q = admin
      .from("inv_historico_marca_mensual")
      .select("*, inv_marcas(codigo, nombre)")
      .order("anio")
      .order("mes");
    if (marcaParam) q = q.in("marca_id", marcaParam.split(","));
    const { data, error } = await q;
    if (error) {
      console.error(error);
      return jsonResponse({ error: "lookup_failed" }, 500);
    }
    return jsonResponse({ filas: data });
  }

  return jsonResponse({ error: "vista_desconocida" }, 400);
});
