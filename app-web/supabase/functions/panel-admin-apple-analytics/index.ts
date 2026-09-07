// Edge Function: panel-admin-apple-analytics
//
// Le entrega al panel de admin la analítica de App Store Connect (descargas,
// impresiones, tasa de conversión), combinada con la serie interna de
// registros por día -- parte 195, pedido explícito del usuario: "SACA TODA
// LA INFO DE AHI Y PONLA EN EL PANEL Y COMBIANALA CON LA INFO QUE YA
// TENEMOS... no quiero estarle teneindo que picar para hacer la consulta ya
// traela de manera periodica".
//
// Por default (body vacío o {forzar:false}) esta función NO llama a Apple
// en vivo -- solo lee la fila ya calculada por sync-analitica-apple (cron
// diario) en la tabla analitica_apple_cache. Eso hace que abrir el panel
// sea instantáneo en vez de esperar varias llamadas encadenadas a la API de
// Apple. Con {forzar:true} (botón "Actualizar ahora" del panel) sí corre el
// pipeline completo en vivo y actualiza la caché de una vez, para cuando el
// usuario quiere ver el dato más fresco posible sin esperar al cron.
//
// Solo para el dueño de la app (mismo patrón de correo admin que
// panel-admin-kpis: nunca se confía en nada que mande el cliente).

import { createClient } from "npm:@supabase/supabase-js@2";
import { obtenerAnaliticaApple } from "../_shared/apple_analytics.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CORREOS_ADMIN = ["samuelnates@gmail.com"];

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

  let forzar = false;
  try {
    const body = await req.json();
    forzar = !!body?.forzar;
  } catch {
    // body vacío -- comportamiento default (leer caché), no es error.
  }

  if (forzar) {
    try {
      const resultado = await obtenerAnaliticaApple();
      const ahora = new Date().toISOString();
      await admin.from("analitica_apple_cache").upsert({ id: "actual" }, { onConflict: "id", ignoreDuplicates: true });
      await admin.from("analitica_apple_cache").update({
        datos: resultado,
        actualizado_en: ahora,
        ultimo_intento_en: ahora,
        ultimo_error: null,
      }).eq("id", "actual");
      const { data: fila } = await admin.from("analitica_apple_cache").select("registros_internos").eq("id", "actual").maybeSingle();
      return jsonResponse({
        datos: resultado,
        actualizadoEn: ahora,
        registrosInternos: fila?.registros_internos ?? {},
        ultimoError: null,
        refrescadoAhora: true,
      });
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: "apple_api_error", detalle }, 502);
    }
  }

  const { data: fila, error: errorFila } = await admin
    .from("analitica_apple_cache")
    .select("datos, registros_internos, actualizado_en, ultimo_intento_en, ultimo_error")
    .eq("id", "actual")
    .maybeSingle();
  if (errorFila) {
    return jsonResponse({ error: "db_error", detalle: errorFila.message }, 500);
  }
  if (!fila || !fila.datos) {
    // Todavía no ha corrido el cron ni una vez -- primer uso real.
    return jsonResponse({
      datos: null,
      actualizadoEn: null,
      registrosInternos: fila?.registros_internos ?? {},
      ultimoError: fila?.ultimo_error ?? null,
      avisoSinDatos: "Todavía no hay analítica de Apple guardada -- usa 'Actualizar ahora' para traerla por primera vez (después se refresca sola una vez al día).",
    });
  }

  return jsonResponse({
    datos: fila.datos,
    actualizadoEn: fila.actualizado_en,
    registrosInternos: fila.registros_internos ?? {},
    ultimoError: fila.ultimo_error ?? null,
  });
});
