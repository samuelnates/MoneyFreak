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

type UsuarioBasico = {
  id: string;
  email: string | undefined;
  created_at: string;
  last_sign_in_at: string | null;
  proveedor: string | null;
};

async function listarTodosLosUsuarios(admin: ReturnType<typeof createClient>): Promise<UsuarioBasico[]> {
  const usuarios: UsuarioBasico[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const u of data.users) {
      usuarios.push({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        proveedor: (u.app_metadata as { provider?: string } | undefined)?.provider ?? null,
      });
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

    // Serie de registros por día, últimos 30 días -- para la gráfica.
    const registrosPorDia: Record<string, number> = {};
    for (const u of usuarios) {
      if (u.created_at < hace30d) continue;
      const dia = u.created_at.slice(0, 10);
      registrosPorDia[dia] = (registrosPorDia[dia] || 0) + 1;
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

    // Errores/crasheos de la app (registro propio, ver tabla errores_app) --
    // se agrupan por mensaje para ver qué falla más, no una lista plana.
    const { count: errores24h, error: errorErrores24h } = await admin
      .from("errores_app")
      .select("id", { count: "exact", head: true })
      .gte("creado_en", hace24h);
    if (errorErrores24h) console.error("panel-admin-kpis: error contando errores 24h:", errorErrores24h);

    const { data: errores7dDetalle, error: errorErrores7d } = await admin
      .from("errores_app")
      .select("mensaje")
      .gte("creado_en", hace7d);
    if (errorErrores7d) console.error("panel-admin-kpis: error leyendo errores 7d:", errorErrores7d);

    const conteoErrores: Record<string, number> = {};
    for (const e of errores7dDetalle || []) {
      conteoErrores[e.mensaje] = (conteoErrores[e.mensaje] || 0) + 1;
    }
    const erroresTop7d = Object.entries(conteoErrores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([mensaje, veces]) => ({ mensaje, veces }));

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

    // Configuración preferida -- avatar de Freaky (siempre se guardó server-side),
    // e idioma/tema (recién empezaron a guardarse server-side el 2026-08-27; antes
    // solo vivían en localStorage de cada dispositivo, así que usuarios que no
    // hayan vuelto a tocar Configuración desde entonces van a salir en null aquí
    // aunque sí tengan una preferencia real guardada en su teléfono).
    const { data: preferencias, error: errorPreferencias } = await admin
      .from("perfil_financiero")
      .select("user_id, avatar_asesor, idioma_preferido, tema_preferido");
    if (errorPreferencias) throw errorPreferencias;

    const contarValores = (campo: "avatar_asesor" | "idioma_preferido" | "tema_preferido") => {
      const conteo: Record<string, number> = {};
      for (const p of preferencias || []) {
        const valor = p[campo];
        if (!valor) continue;
        conteo[valor] = (conteo[valor] || 0) + 1;
      }
      return conteo;
    };

    // Uso por sección -- proxy honesto de "qué se usa más" a partir de datos
    // que ya existen (no hay todavía un registro de vistas de pantalla/eventos
    // de navegación). Por cada tabla: cuántos usuarios distintos tienen algo
    // ahí (adopción) y cuántos escribieron algo en los últimos 30 días (uso
    // reciente). Así se ve qué función de la app engancha de verdad.
    const TABLAS_SECCION: { clave: string; tabla: string }[] = [
      { clave: "cuentas", tabla: "cuentas" },
      { clave: "gastos", tabla: "gastos" },
      { clave: "ingresos", tabla: "ingresos" },
      { clave: "deudas", tabla: "deudas" },
      { clave: "bienes", tabla: "bienes" },
      { clave: "acciones", tabla: "acciones" },
    ];
    const usoPorSeccion: Record<string, { usuariosConDatos: number; activos30d: number }> = {};
    // Conteo de filas por usuario en cada tabla -- se reutiliza abajo para el
    // detalle por usuario (cuántas cuentas/gastos/etc. tiene cada quien), sin
    // repetir estas mismas consultas.
    const conteoPorTablaPorUsuario: Record<string, Record<string, number>> = {};
    // Uso reciente (proxy de actividad general, no solo de "gastos"):
    // usuarios distintos con al menos un gasto registrado en cada ventana.
    // No hay tabla de sesiones/analytics todavía, así que "registrar un
    // gasto" es la señal de uso real más directa que existe hoy. Se calcula
    // aquí mismo, reutilizando la consulta de la tabla "gastos" de abajo.
    const activos24h = new Set<string>();
    const activos7d = new Set<string>();
    const activos30d = new Set<string>();
    for (const { clave, tabla } of TABLAS_SECCION) {
      const { data: filas, error: errorFilas } = await admin
        .from(tabla)
        .select("user_id, created_at");
      if (errorFilas) {
        console.error(`panel-admin-kpis: error leyendo ${tabla}:`, errorFilas);
        continue;
      }
      const usuariosConDatos = new Set<string>();
      const usuariosActivos30d = new Set<string>();
      const conteoUsuario: Record<string, number> = {};
      for (const f of filas || []) {
        usuariosConDatos.add(f.user_id);
        conteoUsuario[f.user_id] = (conteoUsuario[f.user_id] || 0) + 1;
        if (f.created_at && f.created_at >= hace30d) usuariosActivos30d.add(f.user_id);
        if (clave === "gastos" && f.created_at >= hace30d) {
          activos30d.add(f.user_id);
          if (f.created_at >= hace7d) activos7d.add(f.user_id);
          if (f.created_at >= hace24h) activos24h.add(f.user_id);
        }
      }
      usoPorSeccion[clave] = { usuariosConDatos: usuariosConDatos.size, activos30d: usuariosActivos30d.size };
      conteoPorTablaPorUsuario[clave] = conteoUsuario;
    }

    // Freaky (asistente IA): activación (quién canjeó/tiene acceso) y reportes
    // ("radiografía mensual") generados -- la señal más directa de que alguien
    // de verdad usa la IA, no solo que la tiene disponible.
    const { data: accesoIAFilas, error: errorAccesoIA } = await admin
      .from("accesos_ia_usuarios")
      .select("user_id");
    if (errorAccesoIA) console.error("panel-admin-kpis: error leyendo accesos IA:", errorAccesoIA);
    const usuariosConAccesoIASet = new Set((accesoIAFilas || []).map((a) => a.user_id));

    const { data: reportes, error: errorReportes } = await admin
      .from("reportes_financieros")
      .select("user_id, report_month, status, created_at");
    if (errorReportes) console.error("panel-admin-kpis: error leyendo reportes_financieros:", errorReportes);

    const reportesCompletados = (reportes || []).filter((r) => r.status === "completed");
    const usuariosConReporte = new Set(reportesCompletados.map((r) => r.user_id));
    const mesActual = new Date().toISOString().slice(0, 7);
    const reportesEsteMes = reportesCompletados.filter((r) => r.report_month === mesActual).length;

    const reportesPorUsuario: Record<string, number> = {};
    for (const r of reportesCompletados) {
      reportesPorUsuario[r.user_id] = (reportesPorUsuario[r.user_id] || 0) + 1;
    }

    const preferenciasPorUsuario: Record<string, { avatar_asesor: string | null; idioma_preferido: string | null; tema_preferido: string | null }> = {};
    for (const p of preferencias || []) {
      preferenciasPorUsuario[p.user_id] = p;
    }

    // Detalle por usuario -- para soporte/entender uso real. A propósito NO
    // incluye montos ni información financiera real de nadie (saldos,
    // deudas, ingresos en pesos): solo conteos y metadatos de cuenta. Ver
    // nota de privacidad en la parte 40 de CONTEXTO_PROYECTO.md.
    const detalleUsuarios = usuarios.map((u) => {
      const pref = preferenciasPorUsuario[u.id];
      return {
        id: u.id,
        correo: u.email ?? null,
        fechaAlta: u.created_at,
        ultimoLogin: u.last_sign_in_at,
        proveedor: u.proveedor,
        cuentas: conteoPorTablaPorUsuario.cuentas?.[u.id] || 0,
        gastos: conteoPorTablaPorUsuario.gastos?.[u.id] || 0,
        ingresos: conteoPorTablaPorUsuario.ingresos?.[u.id] || 0,
        deudas: conteoPorTablaPorUsuario.deudas?.[u.id] || 0,
        bienes: conteoPorTablaPorUsuario.bienes?.[u.id] || 0,
        acciones: conteoPorTablaPorUsuario.acciones?.[u.id] || 0,
        avatarAsesor: pref?.avatar_asesor ?? null,
        idioma: pref?.idioma_preferido ?? null,
        tema: pref?.tema_preferido ?? null,
        accesoIA: usuariosConAccesoIASet.has(u.id),
        reportesGenerados: reportesPorUsuario[u.id] || 0,
      };
    });

    return jsonResponse({
      crecimiento: {
        totalUsuarios,
        nuevosHoy,
        nuevos7d,
        nuevos30d,
        registrosPorDia,
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
        errores24h: errores24h ?? null,
        erroresTop7d,
      },
      audiencia: {
        gastoPorCategoria,
        ingresoPromedioMensual,
        usuariosConIngresoDeclarado: ingresosUsuarios.length,
      },
      configuracion: {
        avatar: contarValores("avatar_asesor"),
        idioma: contarValores("idioma_preferido"),
        tema: contarValores("tema_preferido"),
      },
      usoPorSeccion,
      freaky: {
        usuariosConAccesoIA: usuariosConAccesoIASet.size,
        usuariosConReporte: usuariosConReporte.size,
        reportesGenerados: reportesCompletados.length,
        reportesEsteMes,
      },
      detalleUsuarios,
    });
  } catch (e) {
    console.error("panel-admin-kpis: error calculando KPIs:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
