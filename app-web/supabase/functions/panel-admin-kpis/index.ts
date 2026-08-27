// Edge Function: panel-admin-kpis
//
// Devuelve los KPIs del panel de administración (solo para el dueño de la
// app, nunca para usuarios normales): crecimiento de usuarios, activación,
// uso reciente y lista de altas recientes.
//
// Seguridad: se verifica el JWT de quien llama con admin.auth.getUser(token)
// (mismo patrón que eliminar-mi-cuenta) y se compara el correo real contra
// una lista fija de correos admin -- nunca se confía en nada que mande el
// cliente. Todo lo que se calcula aquí usa la service role key (bypassa
// RLS), por eso es indispensable este filtro antes de devolver cualquier dato.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Ajusta/agrega aquí los correos que deben poder ver el panel de admin.
const CORREOS_ADMIN = ["samuelnates@gmail.com"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function listarTodosLosUsuarios(admin: ReturnType<typeof createClient>) {
  const usuarios: { id: string; email: string | undefined; created_at: string }[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const u of data.users) {
      usuarios.push({ id: u.id, email: u.email, created_at: u.created_at });
    }
    if (data.users.length < perPage) break;
    page++;
  }
  return usuarios;
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

  try {
    const ahora = Date.now();
    const hace24h = new Date(ahora - 24 * 60 * 60 * 1000).toISOString();
    const hace7d = new Date(ahora - 7 * 24 * 60 * 60 * 1000).toISOString();
    const hace30d = new Date(ahora - 30 * 24 * 60 * 60 * 1000).toISOString();
    const inicioHoy = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

    const usuarios = await listarTodosLosUsuarios(admin);
    const totalUsuarios = usuarios.length;
    const nuevosHoy = usuarios.filter((u) => u.created_at >= inicioHoy).length;
    const nuevos7d = usuarios.filter((u) => u.created_at >= hace7d).length;
    const nuevos30d = usuarios.filter((u) => u.created_at >= hace30d).length;

    const registrosOrdenados = [...usuarios].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const registrosRecientes = registrosOrdenados.slice(0, 20).map((u) => ({
      correo: u.email,
      fecha: u.created_at,
    }));

    // Serie de registros por día, últimos 30 días -- para la gráfica.
    const registrosPorDia: Record<string, number> = {};
    for (const u of usuarios) {
      if (u.created_at < hace30d) continue;
      const dia = u.created_at.slice(0, 10);
      registrosPorDia[dia] = (registrosPorDia[dia] || 0) + 1;
    }

    // Uso reciente (proxy de actividad): usuarios distintos con al menos un
    // gasto registrado en cada ventana. No hay tabla de sesiones/analytics
    // todavía, así que "registrar un gasto" es la señal de uso real más
    // directa que existe hoy.
    const { data: gastosRecientes, error: errorGastos } = await admin
      .from("gastos")
      .select("user_id, created_at")
      .gte("created_at", hace30d);
    if (errorGastos) throw errorGastos;

    const activos24h = new Set<string>();
    const activos7d = new Set<string>();
    const activos30d = new Set<string>();
    for (const g of gastosRecientes || []) {
      activos30d.add(g.user_id);
      if (g.created_at >= hace7d) activos7d.add(g.user_id);
      if (g.created_at >= hace24h) activos24h.add(g.user_id);
    }

    // Activación: de todos los usuarios registrados, ¿cuántos alguna vez
    // llegaron a crear al menos una cuenta? (primer paso real dentro de la
    // app, más allá de solo registrarse).
    const { data: cuentasTodas, error: errorCuentas } = await admin
      .from("cuentas")
      .select("user_id");
    if (errorCuentas) throw errorCuentas;
    const usuariosConCuenta = new Set((cuentasTodas || []).map((c) => c.user_id));

    // Cola de aprobaciones pendiente (fotos de tickets sin revisar) --
    // señal de salud/soporte, no de crecimiento.
    const { count: solicitudesPendientes, error: errorSolicitudes } = await admin
      .from("solicitudes_gasto_pendientes")
      .select("id", { count: "exact", head: true })
      .eq("estado", "pendiente");
    if (errorSolicitudes) console.error("panel-admin-kpis: error contando solicitudes pendientes:", errorSolicitudes);

    // Estadísticas de audiencia -- SIEMPRE agregadas/anónimas, nunca por
    // usuario individual. Sirven para decisiones de producto y, si algún día
    // se vende espacio publicitario dentro de la app, como "media kit"
    // (perfil de audiencia) sin exponer ni vender el dato de nadie en lo
    // individual. No incluye género/edad porque la app no los recolecta.
    const hace90d = new Date(ahora - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: gastos90d, error: errorGastos90d } = await admin
      .from("gastos")
      .select("categoria, monto")
      .gte("created_at", hace90d);
    if (errorGastos90d) throw errorGastos90d;

    const gastoPorCategoria: Record<string, number> = {};
    for (const g of gastos90d || []) {
      const cat = g.categoria || "Sin categoría";
      gastoPorCategoria[cat] = (gastoPorCategoria[cat] || 0) + Number(g.monto || 0);
    }

    // Ingreso promedio mensual: se suma el ingreso "mensual" declarado por
    // cada usuario (puede tener más de una fuente) y luego se promedia entre
    // los usuarios que sí capturaron al menos un ingreso -- es opcional, así
    // que no todos lo tienen.
    const { data: ingresosTodos, error: errorIngresos } = await admin
      .from("ingresos")
      .select("user_id, monto, periodicidad")
      .eq("periodicidad", "mensual");
    if (errorIngresos) throw errorIngresos;

    const ingresoPorUsuario: Record<string, number> = {};
    for (const i of ingresosTodos || []) {
      ingresoPorUsuario[i.user_id] = (ingresoPorUsuario[i.user_id] || 0) + Number(i.monto || 0);
    }
    const ingresosUsuarios = Object.values(ingresoPorUsuario);
    const ingresoPromedioMensual = ingresosUsuarios.length
      ? ingresosUsuarios.reduce((a, b) => a + b, 0) / ingresosUsuarios.length
      : null;

    return jsonResponse({
      crecimiento: {
        totalUsuarios,
        nuevosHoy,
        nuevos7d,
        nuevos30d,
        registrosPorDia,
        registrosRecientes,
      },
      activacion: {
        usuariosConCuenta: usuariosConCuenta.size,
        totalUsuarios,
        tasaActivacion: totalUsuarios ? usuariosConCuenta.size / totalUsuarios : 0,
      },
      uso: {
        activos24h: activos24h.size,
        activos7d: activos7d.size,
        activos30d: activos30d.size,
      },
      salud: {
        solicitudesPendientes: solicitudesPendientes ?? null,
      },
      audiencia: {
        gastoPorCategoria,
        ingresoPromedioMensual,
        usuariosConIngresoDeclarado: ingresosUsuarios.length,
      },
    });
  } catch (e) {
    console.error("panel-admin-kpis: error calculando KPIs:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
