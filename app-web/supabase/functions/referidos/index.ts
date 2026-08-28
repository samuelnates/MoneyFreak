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
    const avataresDesbloqueados = ESCALERA_PREMIOS.filter((p) => activados >= p.activados).map((p) => p.avatar);

    return jsonResponse({
      codigo: perfil?.codigo_referido || null,
      referidosActivados: activados,
      referidosTotales: totales,
      avataresDesbloqueados,
      sinAnuncios: !!perfil?.sin_anuncios,
      escalera: ESCALERA_PREMIOS,
    });
  } catch (e) {
    console.error("referidos: error:", e);
    return jsonResponse({ error: "internal_error", detalle: String(e) }, 500);
  }
});
