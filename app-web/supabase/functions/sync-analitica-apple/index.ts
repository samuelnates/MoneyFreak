// Edge Function: sync-analitica-apple
//
// Refresca la caché de analítica de App Store Connect (tabla
// analitica_apple_cache) una vez al día -- parte 195, pedido explícito del
// usuario: "no quiero estarle teneindo que picar para hacer la consulta ya
// traela de manera periodica". Llamada por pg_cron + net.http_post, mismo
// patrón ya probado en revisar-alertas-presupuesto: protegida con el
// secreto compartido CRON_SECRET (header x-cron-secret) en vez de requerir
// JWT de usuario, porque quien la llama es un cron job del sistema.
//
// También aprovecha para calcular una serie interna de registros por día
// (últimos 30 días) y guardarla junto a los datos de Apple en la misma
// fila, para que panel-admin-apple-analytics pueda armar el embudo de
// adquisición (impresiones/descargas de Apple -> registro real en la app)
// sin tener que volver a consultar auth.admin.listUsers() cada vez que se
// abre el panel.

import { createClient } from "npm:@supabase/supabase-js@2";
import { obtenerAnaliticaApple } from "../_shared/apple_analytics.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Serie interna de registros por día, últimos 30 días -- mismo cálculo que
  // panel-admin-kpis (registrosPorDia), para poder cruzarla con las
  // descargas de Apple sin depender de que ambas funciones se llamen juntas.
  const registrosPorDia: Record<string, number> = {};
  try {
    const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      for (const u of data.users) {
        if (u.created_at < hace30d) continue;
        const dia = u.created_at.slice(0, 10);
        registrosPorDia[dia] = (registrosPorDia[dia] || 0) + 1;
      }
      if (data.users.length < perPage) break;
      page++;
    }
  } catch (e) {
    console.error("sync-analitica-apple: error calculando registrosPorDia:", e);
  }

  // Asegura que la fila exista sin tocarla si ya existe -- así el UPDATE de
  // abajo (éxito o fracaso) nunca se pierde por falta de fila.
  await admin.from("analitica_apple_cache").upsert({ id: "actual" }, { onConflict: "id", ignoreDuplicates: true });

  try {
    const resultado = await obtenerAnaliticaApple();
    const { error } = await admin.from("analitica_apple_cache").update({
      datos: resultado,
      registros_internos: registrosPorDia,
      actualizado_en: new Date().toISOString(),
      ultimo_intento_en: new Date().toISOString(),
      ultimo_error: null,
    }).eq("id", "actual");
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, segmentosDescargados: resultado.segmentosDescargados }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error("sync-analitica-apple: error:", detalle);
    // No se borra el "datos" bueno anterior (UPDATE parcial, no upsert de la
    // fila completa) -- solo se anota el intento fallido, para que el panel
    // siga mostrando el último dato real mientras se resuelve lo que sea que
    // falló (p.ej. Apple caído, o el colchón de 24-48h de la primera vez).
    await admin.from("analitica_apple_cache").update({
      registros_internos: registrosPorDia,
      ultimo_intento_en: new Date().toISOString(),
      ultimo_error: detalle,
    }).eq("id", "actual");
    return new Response(JSON.stringify({ ok: false, error: detalle }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
