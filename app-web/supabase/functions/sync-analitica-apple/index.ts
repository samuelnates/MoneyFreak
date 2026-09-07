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
//
// Parte 200: también trae la calificación/reseñas reales de App Store
// Connect (nueva función habilitada por el rol Admin de la API key) --
// corre aparte con su propio try/catch, para que un fallo ahí (o al revés)
// nunca tire el refresco completo.

import { createClient } from "npm:@supabase/supabase-js@2";
import { obtenerAnaliticaApple } from "../_shared/apple_analytics.ts";
import { obtenerReseñasApple } from "../_shared/apple_reviews.ts";

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

  const [analiticaResult, reseñasResult] = await Promise.allSettled([obtenerAnaliticaApple(), obtenerReseñasApple()]);

  const actualizacion: Record<string, unknown> = {
    registros_internos: registrosPorDia,
    ultimo_intento_en: new Date().toISOString(),
  };
  const errores: string[] = [];

  if (analiticaResult.status === "fulfilled") {
    actualizacion.datos = analiticaResult.value;
    actualizacion.actualizado_en = new Date().toISOString();
  } else {
    const detalle = analiticaResult.reason instanceof Error ? analiticaResult.reason.message : String(analiticaResult.reason);
    console.error("sync-analitica-apple: error en analítica:", detalle);
    errores.push(`analítica: ${detalle}`);
  }

  if (reseñasResult.status === "fulfilled") {
    actualizacion.reseñas = reseñasResult.value;
  } else {
    const detalle = reseñasResult.reason instanceof Error ? reseñasResult.reason.message : String(reseñasResult.reason);
    console.error("sync-analitica-apple: error en reseñas:", detalle);
    errores.push(`reseñas: ${detalle}`);
  }

  // No se borra el "datos"/"reseñas" bueno anterior en caso de fallo parcial
  // (UPDATE, no upsert de la fila completa) -- si solo una de las dos partes
  // falló, la otra igual se guarda y el panel sigue mostrando lo último
  // bueno de la que falló, mientras se resuelve lo que sea que falló.
  actualizacion.ultimo_error = errores.length ? errores.join(" | ") : null;
  const { error } = await admin.from("analitica_apple_cache").update(actualizacion).eq("id", "actual");
  if (error) console.error("sync-analitica-apple: error guardando en la caché:", error);

  const ok = errores.length === 0 && !error;
  return new Response(JSON.stringify({ ok, errores, dbError: error?.message ?? null }), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
