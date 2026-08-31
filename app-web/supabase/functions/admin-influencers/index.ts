// Edge Function: admin-influencers
//
// CRUD del programa de códigos de influencer (partnerships con creadores de
// contenido de finanzas, aparte del sistema de referidos entre usuarios
// normales -- ver migración 20260831000000_influencers.sql y el manejo del
// canje en la Edge Function `referidos`) + estadísticas por código +
// otorgar/quitar el beneficio a mano en un usuario puntual (soporte /
// corrección de errores, "gente blindada").
//
// También el embudo de PROSPECCIÓN, la etapa antes de que exista un código
// real (ver migración 20260831010000_prospectos_influencer.sql): agregar una
// cuenta candidata encontrada a mano, dar seguimiento por estado
// (prospecto → contactado → respondió sí/no → convertido/descartado), y
// convertir un prospecto en un código de influencer activo sin volver a
// teclear sus datos.
//
// Mismo patrón de seguridad que negocio-movimientos/admin-usuarios: se
// verifica el JWT de quien llama y se compara el correo real contra una
// lista fija de correos admin. Ninguna de las 2 tablas tiene policy de RLS
// para clientes -- esta función (service role) es la única forma de
// tocarlas.

import { createClient } from "npm:@supabase/supabase-js@2";

type SupabaseAdmin = ReturnType<typeof createClient>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CORREOS_ADMIN = ["samuelnates@gmail.com"];

const ESTADOS_VALIDOS = new Set(["activo", "pausado"]);
const ESTADOS_PROSPECTO_VALIDOS = new Set([
  "prospecto",
  "contactado",
  "respondio_si",
  "respondio_no",
  "convertido",
  "descartado",
]);
const PLATAFORMAS_VALIDAS = new Set(["instagram", "tiktok", "otra"]);
// Letras/dígitos en mayúsculas, 3-12 caracteres -- más flexible que el
// código de referido personal (fijo a 6) porque un admin puede querer algo
// memorable ligado al influencer (ej. su usuario de red social), no solo
// aleatorio.
const CODIGO_VALIDO = /^[A-Z0-9]{3,12}$/;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Compartida entre "crear"/"editar" (acción directa) y "convertir_prospecto"
// -- las 2 terminan siendo lo mismo: validar y guardar una fila de
// codigos_influencer. idExistente ausente = crear.
async function guardarInfluencer(
  admin: SupabaseAdmin,
  idExistente: string | undefined,
  datos: Record<string, unknown>,
): Promise<{ error: string } | { ok: true; id: string }> {
  const codigo = String(datos.codigo || "").trim().toUpperCase();
  const nombre = String(datos.nombre || "").trim();
  const redSocial = datos.red_social ? String(datos.red_social).trim().slice(0, 200) : null;
  const contacto = datos.contacto ? String(datos.contacto).trim().slice(0, 200) : null;
  const estado = String(datos.estado || "activo");
  const nota = datos.nota ? String(datos.nota).trim().slice(0, 500) : null;
  const topeRegistros = datos.tope_registros === "" || datos.tope_registros === null || datos.tope_registros === undefined
    ? null
    : Number(datos.tope_registros);

  if (!CODIGO_VALIDO.test(codigo)) return { error: "codigo_invalido" };
  if (!nombre) return { error: "nombre_requerido" };
  if (!ESTADOS_VALIDOS.has(estado)) return { error: "estado_invalido" };
  if (topeRegistros !== null && (!Number.isFinite(topeRegistros) || topeRegistros <= 0)) {
    return { error: "tope_invalido" };
  }

  // El código no puede chocar con el de otro influencer ni con el código de
  // referido personal de un usuario -- comparten el mismo campo de captura
  // en el registro (ver Edge Function referidos).
  const { data: choqueInfluencer } = await admin
    .from("codigos_influencer")
    .select("id")
    .eq("codigo", codigo)
    .neq("id", idExistente || "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  if (choqueInfluencer) return { error: "codigo_en_uso" };
  const { data: choqueReferido } = await admin
    .from("perfil_financiero")
    .select("user_id")
    .eq("codigo_referido", codigo)
    .maybeSingle();
  if (choqueReferido) return { error: "codigo_en_uso" };

  const fila = { codigo, nombre, red_social: redSocial, contacto, estado, nota, tope_registros: topeRegistros };

  if (idExistente) {
    const { error } = await admin.from("codigos_influencer").update(fila).eq("id", idExistente);
    if (error) throw error;
    return { ok: true, id: idExistente };
  }
  const { data, error } = await admin.from("codigos_influencer").insert(fila).select("id").single();
  if (error) throw error;
  return { ok: true, id: data.id as string };
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

  let body: {
    accion?: string;
    id?: string;
    user_id?: string;
    influencer?: Record<string, unknown>;
    prospecto?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  try {
    if (body.accion === "crear" || body.accion === "editar") {
      if (body.accion === "editar" && !body.id) return jsonResponse({ error: "id_requerido" }, 400);
      const resultado = await guardarInfluencer(admin, body.accion === "editar" ? body.id : undefined, body.influencer || {});
      if ("error" in resultado) return jsonResponse({ error: resultado.error }, 400);
      return jsonResponse({ ok: true });
    }

    if (body.accion === "eliminar") {
      if (!body.id) return jsonResponse({ error: "id_requerido" }, 400);
      const { data: fila, error: errorFila } = await admin
        .from("codigos_influencer")
        .select("codigo")
        .eq("id", body.id)
        .maybeSingle();
      if (errorFila) throw errorFila;
      if (!fila) return jsonResponse({ error: "no_encontrado" }, 404);

      // No se borra si ya tiene gente registrada con ese código -- perdería
      // la trazabilidad de por qué esas cuentas tienen sin_anuncios/IA
      // gratis. Para eso está "pausado": deja de aceptar nuevos registros
      // sin desconectar el beneficio de quien ya entró.
      const { count, error: errorConteo } = await admin
        .from("perfil_financiero")
        .select("*", { count: "exact", head: true })
        .eq("influencer_codigo", fila.codigo);
      if (errorConteo) throw errorConteo;
      if (count && count > 0) return jsonResponse({ error: "tiene_registros_pausalo_en_vez" }, 400);

      const { error } = await admin.from("codigos_influencer").delete().eq("id", body.id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    // Otorgar/quitar el beneficio de influencer a mano en un usuario puntual
    // -- para soporte (alguien no pudo teclear el código a tiempo) o
    // corrección de errores. No pasa por ningún código real, así que no
    // suma al conteo/tope de ningún influencer -- queda con
    // influencer_codigo = null a propósito (el beneficio es real, pero no
    // se le atribuye falsamente a un código que nunca usó).
    if (body.accion === "blindar" || body.accion === "desblindar") {
      if (!body.user_id) return jsonResponse({ error: "user_id_requerido" }, 400);
      // upsert, no update: perfil_financiero.user_id tiene default auth.uid()
      // para llamadas del cliente -- esta función corre con la service role,
      // así que hay que pasar el user_id a mano y usar upsert por si, en un
      // caso raro, la fila de este usuario todavía no existiera.
      const cambios = body.accion === "blindar"
        ? { user_id: body.user_id, sin_anuncios: true, ia_gratis_meses: 12 }
        : { user_id: body.user_id, sin_anuncios: false, ia_gratis_meses: null, influencer_codigo: null };
      const { error } = await admin.from("perfil_financiero").upsert(cambios, { onConflict: "user_id" });
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    // ===== Embudo de prospección =====

    if (body.accion === "crear_prospecto") {
      const p = body.prospecto || {};
      const handle = String(p.handle || "").trim().replace(/^@/, "");
      const plataforma = p.plataforma ? String(p.plataforma) : null;
      const nota = p.nota ? String(p.nota).trim().slice(0, 500) : null;
      if (!handle) return jsonResponse({ error: "handle_requerido" }, 400);
      if (plataforma && !PLATAFORMAS_VALIDAS.has(plataforma)) return jsonResponse({ error: "plataforma_invalida" }, 400);

      const { error } = await admin.from("prospectos_influencer").insert({ handle, plataforma, nota });
      if (error) {
        if (error.code === "23505") return jsonResponse({ error: "handle_ya_existe" }, 400);
        throw error;
      }
      return jsonResponse({ ok: true });
    }

    if (body.accion === "editar_prospecto") {
      if (!body.id) return jsonResponse({ error: "id_requerido" }, 400);
      const p = body.prospecto || {};

      const { data: actual, error: errorActual } = await admin
        .from("prospectos_influencer")
        .select("*")
        .eq("id", body.id)
        .maybeSingle();
      if (errorActual) throw errorActual;
      if (!actual) return jsonResponse({ error: "no_encontrado" }, 404);

      const cambios: Record<string, unknown> = { actualizado_en: new Date().toISOString() };
      if (p.handle !== undefined) {
        const handle = String(p.handle).trim().replace(/^@/, "");
        if (!handle) return jsonResponse({ error: "handle_requerido" }, 400);
        cambios.handle = handle;
      }
      if (p.plataforma !== undefined) {
        const plataforma = p.plataforma ? String(p.plataforma) : null;
        if (plataforma && !PLATAFORMAS_VALIDAS.has(plataforma)) return jsonResponse({ error: "plataforma_invalida" }, 400);
        cambios.plataforma = plataforma;
      }
      if (p.nota !== undefined) {
        cambios.nota = p.nota ? String(p.nota).trim().slice(0, 500) : null;
      }
      if (p.estado !== undefined) {
        const estado = String(p.estado);
        if (!ESTADOS_PROSPECTO_VALIDOS.has(estado)) return jsonResponse({ error: "estado_invalido" }, 400);
        cambios.estado = estado;
        // Solo se sella la primera vez que llega a ese estado -- si el admin
        // lo mueve y lo regresa, no se pierde cuándo pasó realmente.
        if (estado === "contactado" && !actual.contactado_en) cambios.contactado_en = new Date().toISOString();
        if ((estado === "respondio_si" || estado === "respondio_no") && !actual.respondido_en) {
          cambios.respondido_en = new Date().toISOString();
        }
      }

      const { error } = await admin.from("prospectos_influencer").update(cambios).eq("id", body.id);
      if (error) {
        if (error.code === "23505") return jsonResponse({ error: "handle_ya_existe" }, 400);
        throw error;
      }
      return jsonResponse({ ok: true });
    }

    if (body.accion === "eliminar_prospecto") {
      if (!body.id) return jsonResponse({ error: "id_requerido" }, 400);
      const { error } = await admin.from("prospectos_influencer").delete().eq("id", body.id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    // Convierte un prospecto en un código de influencer real -- reusa
    // guardarInfluencer (misma validación que "crear") y deja la
    // trazabilidad de qué código nació de qué prospecto en vez de
    // duplicar/perder sus datos.
    if (body.accion === "convertir_prospecto") {
      if (!body.id) return jsonResponse({ error: "id_requerido" }, 400);
      const { data: prospecto, error: errorProspecto } = await admin
        .from("prospectos_influencer")
        .select("*")
        .eq("id", body.id)
        .maybeSingle();
      if (errorProspecto) throw errorProspecto;
      if (!prospecto) return jsonResponse({ error: "no_encontrado" }, 404);
      if (prospecto.estado === "convertido") return jsonResponse({ error: "ya_convertido" }, 400);

      const resultado = await guardarInfluencer(admin, undefined, body.influencer || {});
      if ("error" in resultado) return jsonResponse({ error: resultado.error }, 400);

      const { error: errorUpdate } = await admin
        .from("prospectos_influencer")
        .update({ estado: "convertido", codigo_influencer_id: resultado.id, actualizado_en: new Date().toISOString() })
        .eq("id", body.id);
      if (errorUpdate) throw errorUpdate;
      return jsonResponse({ ok: true, influencerId: resultado.id });
    }

    // Default: listar todos los códigos + estadísticas (registros/activados)
    // y, por código, el detalle de quién se registró con él, más el embudo
    // de prospección completo.
    const { data: influencers, error: errorInfluencers } = await admin
      .from("codigos_influencer")
      .select("*")
      .order("creado_en", { ascending: false });
    if (errorInfluencers) throw errorInfluencers;

    const { data: perfiles, error: errorPerfiles } = await admin
      .from("perfil_financiero")
      .select("user_id, influencer_codigo")
      .not("influencer_codigo", "is", null);
    if (errorPerfiles) throw errorPerfiles;

    const idsPorCodigo: Record<string, string[]> = {};
    for (const p of perfiles || []) {
      if (!p.influencer_codigo) continue;
      (idsPorCodigo[p.influencer_codigo] ||= []).push(p.user_id);
    }
    const todosLosIds = (perfiles || []).map((p) => p.user_id);

    // "Activado" = mismo criterio que el resto de la app: ya agregó al
    // menos una cuenta o un gasto (no solo se registró).
    const activados = new Set<string>();
    if (todosLosIds.length) {
      const [{ data: cuentasAct }, { data: gastosAct }] = await Promise.all([
        admin.from("cuentas").select("user_id").in("user_id", todosLosIds),
        admin.from("gastos").select("user_id").in("user_id", todosLosIds),
      ]);
      for (const r of cuentasAct || []) activados.add(r.user_id);
      for (const r of gastosAct || []) activados.add(r.user_id);
    }

    // perfil_financiero no guarda su propia fecha de alta -- la real vive en
    // auth.users (created_at), mismo lugar de donde panel-admin-kpis saca
    // "fechaAlta" para el resto de la app. Se pide junto con el correo, una
    // sola llamada por usuario en vez de dos.
    const correosPorId: Record<string, string> = {};
    const registradoEnPorId: Record<string, string | null> = {};
    for (const id of todosLosIds) {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email) correosPorId[id] = data.user.email;
      registradoEnPorId[id] = data?.user?.created_at || null;
    }

    const conEstadisticas = (influencers || []).map((inf) => {
      const ids = idsPorCodigo[inf.codigo] || [];
      const activadosCount = ids.filter((id) => activados.has(id)).length;
      return {
        ...inf,
        registros: ids.length,
        activados: activadosCount,
        agotado: inf.tope_registros !== null && ids.length >= inf.tope_registros,
        usuarios: ids.map((id) => ({
          correo: correosPorId[id] || null,
          registrado_en: registradoEnPorId[id],
          activado: activados.has(id),
        })),
      };
    });

    const { data: prospectos, error: errorProspectos } = await admin
      .from("prospectos_influencer")
      .select("*")
      .order("creado_en", { ascending: false });
    if (errorProspectos) throw errorProspectos;

    return jsonResponse({ influencers: conEstadisticas, prospectos: prospectos || [] });
  } catch (e) {
    console.error("admin-influencers: error:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
