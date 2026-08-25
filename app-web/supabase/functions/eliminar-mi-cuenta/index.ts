// Edge Function: eliminar-mi-cuenta
//
// Borra POR COMPLETO la cuenta de quien llama: todos sus datos financieros
// en las tablas de public (mismo alcance que TABLAS_USUARIO en index.html,
// más accesos_ia_usuarios/reportes_financieros/solicitudes_gasto_pendientes,
// que "Borrar mis datos" no toca) y, al final, el usuario real de
// auth.users — eso último solo se puede hacer con la service role key, no
// existe un método de cliente para que alguien borre su propio auth.users.
//
// Requisito de Apple (App Store Guideline 5.1.1(v)): si la app deja crear
// una cuenta, tiene que dejar eliminarla por completo desde dentro de la
// app, no solo "borrar mis datos" dejando el acceso (correo/contraseña)
// vivo — que es justo lo que hacía "Borrar mis datos" hasta ahora.
//
// Se usa el mismo patrón que canjear-codigo-ia: se verifica el JWT de quien
// llama con admin.auth.getUser(token) para saber su userId real -- nunca se
// confía en un id que mande el cliente en el body, o cualquiera podría
// borrar la cuenta de otra persona.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Solo las tablas "padre" -- saldos, bienes_historico y deudas_historico se
// borran solas por ON DELETE CASCADE cuando se borran cuentas/bienes/deudas
// (confirmado en el esquema real). codigos_acceso_ia NO va aquí: es un
// catálogo compartido entre todos los usuarios, no datos de esta cuenta.
const TABLAS_A_BORRAR = [
  "gastos",
  "transferencias",
  "presupuestos",
  "ingresos",
  "acciones",
  "score_historico",
  "patrimonio_historico",
  "deudas",
  "bienes",
  "cuentas",
  "accesos_ia_usuarios",
  "reportes_financieros",
  "solicitudes_gasto_pendientes",
  "perfil_financiero",
];

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

  const erroresPorTabla: Record<string, string> = {};
  for (const tabla of TABLAS_A_BORRAR) {
    const { error } = await admin.from(tabla).delete().eq("user_id", userId);
    if (error) {
      console.error(`eliminar-mi-cuenta: error borrando ${tabla}:`, error);
      erroresPorTabla[tabla] = error.message;
    }
  }

  // Se intenta borrar el usuario de auth SIEMPRE, incluso si algo de arriba
  // falló -- es lo que Apple/GDPR de verdad exigen (que la cuenta deje de
  // existir). Datos huérfanos sin dueño real quedan inaccesibles de todos
  // modos: ninguna sesión futura podrá volver a tener ese auth.uid().
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    console.error("eliminar-mi-cuenta: error borrando el usuario de auth:", deleteUserError);
    return jsonResponse({
      error: "delete_user_failed",
      detalle: deleteUserError.message,
      erroresPorTabla,
    }, 500);
  }

  return jsonResponse({
    ok: true,
    erroresPorTabla: Object.keys(erroresPorTabla).length ? erroresPorTabla : undefined,
  });
});
