// Edge Function: revisar-onboarding-inactivo
//
// Parte 202, pedido explícito del usuario: acompañamiento activo para
// cuentas nuevas que no saben por dónde empezar. Corre una vez al día por
// cron (mismo patrón que revisar-alertas-presupuesto: pg_cron + net.http_post,
// protegida con CRON_SECRET) y manda un push real vía FCM a quien:
// 1) ya activó push (tiene un token en push_tokens -- nunca se le pide
//    permiso a nadie que no lo haya prendido antes, mismo criterio que el
//    resto de la app),
// 2) su cuenta tiene entre 1 y 14 días de creada (el límite de 14 evita que,
//    al desplegar esto por primera vez, se le mande un push "¿ya
//    empezaste?" a cuentas viejas y abandonadas hace meses -- eso sería
//    ruido, no acompañamiento), y
// 3) sigue sin capturar NADA (cero cuentas, bienes, acciones, deudas,
//    gastos e ingresos) -- mismo criterio que sinNingunDatoCapturado del
//    cliente (calcularInsightsPanel).
//
// Manda como máximo 2 avisos por cuenta (día 1 y día 3), nunca más --
// llevados en onboarding_nudge_estado para no repetir aunque el cron corra
// todos los días mientras la cuenta se mantenga vacía.

import { createClient } from "npm:@supabase/supabase-js@2";
import { mandarPush, obtenerAccessTokenFCM } from "../_shared/fcm.ts";

const EDAD_MAXIMA_DIAS = 14;
const UMBRAL_DIA1_DIAS = 3; // edad < este umbral -> aviso "día 1"; edad >= -> aviso "día 3"

const TABLAS_A_REVISAR = ["cuentas", "bienes", "acciones", "deudas", "gastos", "ingresos"] as const;

type UsuarioBasico = { id: string; created_at: string };

async function listarTodosLosUsuarios(admin: ReturnType<typeof createClient>): Promise<UsuarioBasico[]> {
  const usuarios: UsuarioBasico[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const u of data.users) usuarios.push({ id: u.id, created_at: u.created_at });
    if (data.users.length < perPage) break;
    page++;
  }
  return usuarios;
}

async function estaVacio(admin: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  for (const tabla of TABLAS_A_REVISAR) {
    const { count, error } = await admin.from(tabla).select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw error;
    if ((count ?? 0) > 0) return false;
  }
  return true;
}

function mensajePara(cual: "dia1" | "dia3", enIngles: boolean): { titulo: string; cuerpo: string } {
  if (cual === "dia1") {
    return enIngles
      ? { titulo: "Let's get you started", cuerpo: "Add your first account, income, or expense -- it takes two minutes and I can start giving you real advice." }
      : { titulo: "Empecemos", cuerpo: "Agrega tu primera cuenta, ingreso o gasto -- toma dos minutos y ya puedo empezar a darte consejos reales." };
  }
  return enIngles
    ? { titulo: "Still there?", cuerpo: "Your account is still empty -- add anything real and I'll start showing you your numbers and a score." }
    : { titulo: "¿Seguimos?", cuerpo: "Tu cuenta sigue vacía -- agrega algo real y empiezo a mostrarte tus números y un score." };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const firebaseJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!firebaseJson) return new Response(JSON.stringify({ error: "firebase_no_configurado" }), { status: 500 });
  const serviceAccount = JSON.parse(firebaseJson);

  const { data: tokensFilas, error: errorTokens } = await admin.from("push_tokens").select("user_id, token");
  if (errorTokens) {
    console.error("Error leyendo push_tokens:", errorTokens);
    return new Response(JSON.stringify({ error: "error_leyendo_tokens" }), { status: 500 });
  }
  if (!tokensFilas || tokensFilas.length === 0) {
    return new Response(JSON.stringify({ ok: true, usuarios_evaluados: 0 }));
  }

  const tokensPorUsuario: Record<string, string[]> = {};
  (tokensFilas as { user_id: string; token: string }[]).forEach((f) => {
    (tokensPorUsuario[f.user_id] ??= []).push(f.token);
  });
  const userIds = Object.keys(tokensPorUsuario);

  const [usuarios, { data: perfiles, error: errorPerfiles }] = await Promise.all([
    listarTodosLosUsuarios(admin),
    admin.from("perfil_financiero").select("user_id, idioma_preferido").in("user_id", userIds),
  ]);
  if (errorPerfiles) console.error("Error leyendo idioma preferido (se sigue en español por default):", errorPerfiles);

  const creadoPorId: Record<string, string> = {};
  usuarios.forEach((u) => { if (userIds.includes(u.id)) creadoPorId[u.id] = u.created_at; });
  const idiomaPorId: Record<string, string | null> = {};
  (perfiles as { user_id: string; idioma_preferido: string | null }[] || []).forEach((p) => { idiomaPorId[p.user_id] = p.idioma_preferido; });

  let accessTokenFCM: string | null = null;
  const resumen = { evaluados: 0, dia1: 0, dia3: 0, errores: 0 };

  for (const userId of userIds) {
    try {
      const creadoEn = creadoPorId[userId];
      if (!creadoEn) continue; // token huérfano (usuario borrado) -- no debería pasar, pero no truena
      const edadDias = (Date.now() - new Date(creadoEn).getTime()) / 86400000;
      if (edadDias < 1 || edadDias >= EDAD_MAXIMA_DIAS) continue;
      resumen.evaluados++;

      if (!(await estaVacio(admin, userId))) continue;

      const { data: estado } = await admin.from("onboarding_nudge_estado").select("dia1_enviado, dia3_enviado").eq("user_id", userId).maybeSingle();
      const dia1Enviado = estado?.dia1_enviado ?? false;
      const dia3Enviado = estado?.dia3_enviado ?? false;

      let cual: "dia1" | "dia3" | null = null;
      if (edadDias < UMBRAL_DIA1_DIAS && !dia1Enviado) cual = "dia1";
      else if (edadDias >= UMBRAL_DIA1_DIAS && !dia3Enviado) cual = "dia3";
      if (!cual) continue;

      if (!accessTokenFCM) accessTokenFCM = await obtenerAccessTokenFCM(serviceAccount);
      const { titulo, cuerpo } = mensajePara(cual, idiomaPorId[userId] === "en");

      let algunoOk = false;
      for (const token of tokensPorUsuario[userId]) {
        const ok = await mandarPush(accessTokenFCM, serviceAccount.project_id, token, titulo, cuerpo, `onboarding_${cual}`);
        if (ok) algunoOk = true;
      }
      if (algunoOk) {
        resumen[cual]++;
        await admin.from("onboarding_nudge_estado").upsert({
          user_id: userId,
          dia1_enviado: cual === "dia1" ? true : dia1Enviado,
          dia3_enviado: cual === "dia3" ? true : dia3Enviado,
          actualizado_en: new Date().toISOString(),
        });
      }
    } catch (e) {
      resumen.errores++;
      console.error("Error evaluando el nudge de onboarding para un usuario:", e);
    }
  }

  return new Response(JSON.stringify({ ok: true, ...resumen }));
});
