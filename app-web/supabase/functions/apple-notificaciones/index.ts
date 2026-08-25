// Edge Function: apple-notificaciones
//
// Endpoint de "Server-to-Server Notifications" de Sign in with Apple. Apple
// exige una URL real aquí para poder activar "Sign In with Apple" como
// capability del App ID (el usuario confirmó que el campo SÍ es obligatorio
// en el portal actual, aunque la documentación pública lo describe como
// opcional -- se prioriza lo que Apple realmente pide en la práctica).
//
// Apple manda un POST con Content-Type: application/x-www-form-urlencoded
// y un solo campo `payload` con un JWT firmado. Los eventos posibles
// (claim `type`): email-disabled, email-enabled, consent-revoked,
// account-delete.
//
// IMPORTANTE -- estado actual, a propósito conservador:
// Esta primera versión SOLO decodifica y registra el evento (console.log),
// sin verificar la firma criptográfica todavía -- verificar requiere saber
// el `aud` esperado (el Services ID que Supabase usará para el proveedor
// Apple), que todavía no existe. Por eso, a propósito, TODAVÍA NO se conecta
// ninguna acción destructiva (como borrar la cuenta) a `account-delete` --
// hacerlo sin verificar la firma dejaría un hueco real: cualquiera podría
// mandar un payload falso y borrar la cuenta de otra persona. Siguiente
// paso, una vez exista el Services ID: verificar la firma contra
// https://appleid.apple.com/auth/keys (JWKS) y el `aud` correcto, y solo
// entonces conectar `account-delete`/`consent-revoked` con la misma lógica
// de borrado que ya usa eliminar-mi-cuenta (buscando al usuario por su
// identidad de Apple en vez de por JWT de sesión, ya que aquí quien llama
// es Apple, no el usuario).
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }

  try {
    const form = await req.formData();
    const payload = form.get("payload");
    if (typeof payload === "string") {
      const partes = payload.split(".");
      if (partes.length === 3) {
        const claims = JSON.parse(atob(partes[1].replace(/-/g, "+").replace(/_/g, "/")));
        console.log("apple-notificaciones: evento recibido", {
          type: claims.type,
          sub: claims.sub,
          event_time: claims.event_time,
        });
      } else {
        console.warn("apple-notificaciones: payload con formato inesperado (no es un JWT de 3 partes)");
      }
    } else {
      console.warn("apple-notificaciones: petición sin campo 'payload'");
    }
  } catch (e) {
    console.error("apple-notificaciones: error procesando la notificación", e);
  }

  // Apple espera una respuesta 200 rápida -- no importa si arriba hubo un
  // error de parseo, seguimos respondiendo 200 para no generar reintentos
  // innecesarios por errores que ya quedaron registrados en el log.
  return new Response(null, { status: 200 });
});
