// Edge Function: negocio-movimientos
//
// CRUD del registro de negocio de Money Freak (inversión, gastos operativos,
// ingresos) -- solo para el dueño de la app, nunca para usuarios normales.
// Mismo patrón de seguridad que panel-admin-kpis: se verifica el JWT de
// quien llama y se compara el correo real contra una lista fija de correos
// admin. La tabla negocio_movimientos no tiene ninguna policy de RLS para
// anon/authenticated -- esta función (service role) es la ÚNICA forma de
// tocarla.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CORREOS_ADMIN = ["samuelnates@gmail.com"];

const TIPOS_VALIDOS = new Set(["ingreso", "gasto", "inversion"]);
const MONEDAS_VALIDAS = new Set(["USD", "MXN"]);

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
  const correo = (userData.user.email || "").toLowerCase();
  if (!CORREOS_ADMIN.includes(correo)) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  let body: { accion?: string; movimiento?: Record<string, unknown>; id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  try {
    if (body.accion === "crear") {
      const m = body.movimiento || {};
      const tipo = String(m.tipo || "");
      const categoria = String(m.categoria || "").trim();
      const monto = Number(m.monto);
      const moneda = String(m.moneda || "USD");
      const fecha = String(m.fecha || "");
      if (!TIPOS_VALIDOS.has(tipo)) return jsonResponse({ error: "tipo_invalido" }, 400);
      if (!MONEDAS_VALIDAS.has(moneda)) return jsonResponse({ error: "moneda_invalida" }, 400);
      if (!categoria) return jsonResponse({ error: "categoria_requerida" }, 400);
      if (!fecha) return jsonResponse({ error: "fecha_requerida" }, 400);
      if (!Number.isFinite(monto) || monto <= 0) return jsonResponse({ error: "monto_invalido" }, 400);

      const { error } = await admin.from("negocio_movimientos").insert({
        fecha,
        tipo,
        categoria,
        concepto: m.concepto ? String(m.concepto).slice(0, 300) : null,
        monto,
        moneda,
        es_recurrente: !!m.es_recurrente,
      });
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.accion === "eliminar") {
      if (!body.id) return jsonResponse({ error: "id_requerido" }, 400);
      const { error } = await admin.from("negocio_movimientos").delete().eq("id", body.id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    // Default: listar todo + resumen.
    const { data: movimientos, error } = await admin
      .from("negocio_movimientos")
      .select("*")
      .order("fecha", { ascending: false })
      .order("creado_en", { ascending: false });
    if (error) throw error;

    const resumen: Record<string, { ingreso: number; gasto: number; inversion: number }> = {};
    for (const mov of movimientos || []) {
      if (!resumen[mov.moneda]) resumen[mov.moneda] = { ingreso: 0, gasto: 0, inversion: 0 };
      resumen[mov.moneda][mov.tipo as "ingreso" | "gasto" | "inversion"] += Number(mov.monto || 0);
    }

    return jsonResponse({ movimientos: movimientos || [], resumen });
  } catch (e) {
    console.error("negocio-movimientos: error:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
