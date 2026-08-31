// Edge Function: referidos
//
// Sistema de "invita a un amigo". Cada usuario tiene un código propio para
// compartir (perfil_financiero.codigo_referido, asignado solo por un
// trigger de la base -- ver migración 20260828010000_referidos.sql).
// Cuando alguien se registra con ese código y de verdad usa la app (agrega
// su primera cuenta o gasto), un trigger de la base lo marca "activado" --
// esta función nunca marca activaciones, solo lee el conteo y resuelve el
// canje del código al momento de registrarse.
//
// La tabla `referidos` no tiene ninguna policy de RLS para clientes -- esta
// función (service role) es la única forma de leerla/escribirla, mismo
// patrón que negocio-movimientos y panel-admin-kpis.
//
// El mismo campo de código en el registro también acepta códigos de
// influencer (programa aparte, curado desde el panel de admin -- ver
// migración 20260831000000_influencers.sql y admin-influencers). Esta
// función revisa ese caso primero dentro de "canjear"; los detalles de ese
// programa se manejan ahí mismo, no en un endpoint separado, porque
// comparten el punto de entrada (el usuario nunca sabe -- ni le importa --
// que son 2 sistemas distintos por debajo).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// A cuántos referidos ACTIVADOS corresponde cada recompensa. Los avatares no
// se guardan como "desbloqueado" en ningún lado -- se calculan aquí mismo
// contando, así nunca se desincronizan del conteo real.
const ESCALERA_PREMIOS = [
  { activados: 1, avatar: "avatar4" },
  { activados: 3, avatar: "avatar5" },
  { activados: 5, avatar: "avatar6", sinAnuncios: true },
];

// El dueño de la app se desbloquea todo a mano para poder ver/probar los
// avatares y la experiencia sin anuncios -- no representa que haya invitado
// a nadie de verdad, así que no se toca la tabla `referidos` (no se inventan
// referidos falsos ni se le atribuyen a otros usuarios reales). Puramente un
// override de la respuesta para este correo.
const CORREOS_DESBLOQUEO_TOTAL = ["samuelnates@gmail.com"];

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
  const userId = userData.user.id;

  let body: { accion?: string; codigo?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    if (body.accion === "canjear") {
      const codigo = String(body.codigo || "").trim().toUpperCase();
      if (!codigo) return jsonResponse({ error: "codigo_requerido" }, 400);

      // Los códigos de influencer (programa aparte, ver migración
      // 20260831000000_influencers.sql) comparten el mismo campo de captura
      // del registro que los códigos de referido normal -- se revisan
      // primero, y si coincide, nunca tocan la tabla `referidos`: no cuentan
      // para la escalera de premios de nadie, solo aplican su propio
      // beneficio (sin anuncios de por vida + crédito de IA gratis).
      const { data: influencer, error: errorInfluencer } = await admin
        .from("codigos_influencer")
        .select("codigo, estado, tope_registros")
        .eq("codigo", codigo)
        .maybeSingle();
      if (errorInfluencer) throw errorInfluencer;

      if (influencer) {
        if (influencer.estado !== "activo") {
          return jsonResponse({ error: "codigo_pausado" }, 400);
        }
        if (influencer.tope_registros !== null) {
          const { count, error: errorConteo } = await admin
            .from("perfil_financiero")
            .select("*", { count: "exact", head: true })
            .eq("influencer_codigo", codigo);
          if (errorConteo) throw errorConteo;
          if ((count || 0) >= influencer.tope_registros) {
            return jsonResponse({ error: "codigo_agotado" }, 400);
          }
        }
        const { data: perfilActual, error: errorPerfilActual } = await admin
          .from("perfil_financiero")
          .select("influencer_codigo")
          .eq("user_id", userId)
          .maybeSingle();
        if (errorPerfilActual) throw errorPerfilActual;
        if (perfilActual?.influencer_codigo) {
          return jsonResponse({ error: "ya_canjeaste_un_codigo" }, 400);
        }
        // upsert, no update: perfil_financiero.user_id tiene default
        // auth.uid() para llamadas del cliente, pero esta función corre con
        // la service role (sin sesión de usuario) -- así que hay que pasar
        // el user_id a mano, y usar upsert (no update) por si esta es la
        // primera escritura de este usuario a la tabla y su fila todavía no
        // existe (mismo riesgo real: el upsert de marcarTerminosAceptados()
        // en el cliente y este canje corren en paralelo, sin esperarse uno
        // al otro -- con un simple update, si el upsert del cliente no ha
        // creado la fila todavía, este canje no actualizaría nada y el
        // beneficio se perdería en silencio).
        const { error: errorUpdate } = await admin
          .from("perfil_financiero")
          .upsert(
            { user_id: userId, influencer_codigo: codigo, sin_anuncios: true, ia_gratis_meses: 12 },
            { onConflict: "user_id" },
          );
        if (errorUpdate) throw errorUpdate;
        return jsonResponse({ ok: true, tipo: "influencer" });
      }

      const { data: yaReferido, error: errorYaReferido } = await admin
        .from("referidos")
        .select("id")
        .eq("referido_id", userId)
        .maybeSingle();
      if (errorYaReferido) throw errorYaReferido;
      if (yaReferido) return jsonResponse({ error: "ya_canjeaste_un_codigo" }, 400);

      const { data: perfilDueno, error: errorDueno } = await admin
        .from("perfil_financiero")
        .select("user_id")
        .eq("codigo_referido", codigo)
        .maybeSingle();
      if (errorDueno) throw errorDueno;
      if (!perfilDueno) return jsonResponse({ error: "codigo_invalido" }, 404);
      if (perfilDueno.user_id === userId) {
        return jsonResponse({ error: "no_puedes_usar_tu_propio_codigo" }, 400);
      }

      const { error: errorInsert } = await admin
        .from("referidos")
        .insert({ referente_id: perfilDueno.user_id, referido_id: userId });
      if (errorInsert) throw errorInsert;
      return jsonResponse({ ok: true });
    }

    // Default: estado -- mi código, cuántos referidos activados llevo, y qué
    // recompensas ya desbloqueo con ese número.
    const { data: perfil, error: errorPerfil } = await admin
      .from("perfil_financiero")
      .select("codigo_referido, sin_anuncios")
      .eq("user_id", userId)
      .maybeSingle();
    if (errorPerfil) throw errorPerfil;

    const { data: misReferidos, error: errorReferidos } = await admin
      .from("referidos")
      .select("activado")
      .eq("referente_id", userId);
    if (errorReferidos) throw errorReferidos;

    const activados = (misReferidos || []).filter((r) => r.activado).length;
    const totales = (misReferidos || []).length;
    const desbloqueoTotal = CORREOS_DESBLOQUEO_TOTAL.includes((userData.user.email || "").toLowerCase());
    const avataresDesbloqueados = desbloqueoTotal
      ? ESCALERA_PREMIOS.map((p) => p.avatar)
      : ESCALERA_PREMIOS.filter((p) => activados >= p.activados).map((p) => p.avatar);

    return jsonResponse({
      codigo: perfil?.codigo_referido || null,
      referidosActivados: activados,
      referidosTotales: totales,
      avataresDesbloqueados,
      sinAnuncios: desbloqueoTotal || !!perfil?.sin_anuncios,
      escalera: ESCALERA_PREMIOS,
    });
  } catch (e) {
    console.error("referidos: error:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
