// Edge Function: admin-influencers
//
// CRUD del programa de códigos de influencer (partnerships con creadores de
// contenido de finanzas, aparte del sistema de referidos entre usuarios
// normales -- ver migración 20260831000000_influencers.sql y el manejo del
// canje en la Edge Function `referidos`) + estadísticas por código +
// otorgar/quitar el beneficio a mano en un usuario puntual (soporte /
// corrección de errores, "gente blindada"). Mismo patrón de seguridad que
// negocio-movimientos/admin-usuarios: se verifica el JWT de quien llama y se
// compara el correo real contra una lista fija de correos admin. La tabla
// codigos_influencer no tiene ninguna policy de RLS para clientes -- esta
// función (service role) es la única forma de tocarla.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CORREOS_ADMIN = ["samuelnates@gmail.com"];

const ESTADOS_VALIDOS = new Set(["activo", "pausado"]);
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

  let body: { accion?: string; id?: string; user_id?: string; influencer?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  try {
    if (body.accion === "crear" || body.accion === "editar") {
      if (body.accion === "editar" && !body.id) return jsonResponse({ error: "id_requerido" }, 400);

      const inf = body.influencer || {};
      const codigo = String(inf.codigo || "").trim().toUpperCase();
      const nombre = String(inf.nombre || "").trim();
      const redSocial = inf.red_social ? String(inf.red_social).trim().slice(0, 200) : null;
      const contacto = inf.contacto ? String(inf.contacto).trim().slice(0, 200) : null;
      const estado = String(inf.estado || "activo");
      const nota = inf.nota ? String(inf.nota).trim().slice(0, 500) : null;
      const topeRegistros = inf.tope_registros === "" || inf.tope_registros === null || inf.tope_registros === undefined
        ? null
        : Number(inf.tope_registros);

      if (!CODIGO_VALIDO.test(codigo)) return jsonResponse({ error: "codigo_invalido" }, 400);
      if (!nombre) return jsonResponse({ error: "nombre_requerido" }, 400);
      if (!ESTADOS_VALIDOS.has(estado)) return jsonResponse({ error: "estado_invalido" }, 400);
      if (topeRegistros !== null && (!Number.isFinite(topeRegistros) || topeRegistros <= 0)) {
        return jsonResponse({ error: "tope_invalido" }, 400);
      }

      // El código no puede chocar con el de otro influencer ni con el
      // código de referido personal de un usuario -- comparten el mismo
      // campo de captura en el registro (ver Edge Function referidos).
      const { data: choqueInfluencer } = await admin
        .from("codigos_influencer")
        .select("id")
        .eq("codigo", codigo)
        .neq("id", body.id || "00000000-0000-0000-0000-000000000000")
        .maybeSingle();
      if (choqueInfluencer) return jsonResponse({ error: "codigo_en_uso" }, 400);
      const { data: choqueReferido } = await admin
        .from("perfil_financiero")
        .select("user_id")
        .eq("codigo_referido", codigo)
        .maybeSingle();
      if (choqueReferido) return jsonResponse({ error: "codigo_en_uso" }, 400);

      const fila = { codigo, nombre, red_social: redSocial, contacto, estado, nota, tope_registros: topeRegistros };

      if (body.accion === "editar") {
        const { error } = await admin.from("codigos_influencer").update(fila).eq("id", body.id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("codigos_influencer").insert(fila);
        if (error) throw error;
      }
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

    // Default: listar todos los códigos + estadísticas (registros/activados)
    // y, por código, el detalle de quién se registró con él.
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

    return jsonResponse({ influencers: conEstadisticas });
  } catch (e) {
    console.error("admin-influencers: error:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
