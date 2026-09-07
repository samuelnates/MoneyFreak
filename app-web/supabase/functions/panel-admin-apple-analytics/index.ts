// Edge Function: panel-admin-apple-analytics
//
// Trae datos reales de la API de Analítica de App Store Connect (descargas,
// impresiones, tasa de conversión) -- pedido explícito del usuario (parte
// 192/193). Solo para el dueño de la app (mismo patrón de correo admin que
// panel-admin-kpis).
//
// LA API DE ANALÍTICA DE APPLE ES ASÍNCRONA, no un solo request-respuesta:
// 1) Se pide (o se reutiliza si ya existe) una "solicitud de reporte
//    continua" (accessType: ONGOING) para la app.
// 2) Esa solicitud trae varios "reportes" (categorías: descubrimiento y
//    interacción, instalaciones y eliminaciones, uso, etc.).
// 3) Cada reporte tiene "instancias" (una por día/semana ya generado).
// 4) Cada instancia trae "segmentos": URLs firmadas a archivos CSV
//    comprimidos con los números reales.
//
// Esta primera versión llega hasta el paso 2 (qué reportes hay disponibles
// para esta app) -- a propósito, en vez de adivinar a ciegas los nombres
// exactos de categoría/reporte que devuelve Apple y arriesgarse a parsear
// mal los CSV. El sandbox de desarrollo no tiene salida de red hacia
// api.appstoreconnect.apple.com para poder probarlo en vivo antes de
// desplegar, así que se pensó para poder ver la respuesta real de Apple
// primero (desde el panel ya desplegado) y hacer el parseo de segmentos/CSV
// en un siguiente paso, ya con los nombres reales confirmados.
//
// Nota importante para el usuario: si esta es la PRIMERA vez que se crea la
// solicitud ONGOING para esta app, Apple tarda 24-48 horas en generar los
// primeros datos -- no es un error de esta función, es tiempo real de
// Apple.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Ajusta/agrega aquí los correos que deben poder ver el panel de admin --
// mismo patrón que panel-admin-kpis (nunca se confía en nada que mande el
// cliente).
const CORREOS_ADMIN = ["samuelnates@gmail.com"];

// Id numérico de Money Freak en App Store Connect -- el mismo que aparece en
// el link real de descarga (apps.apple.com/mx/app/id6805201423).
const APPLE_APP_ID = "6805201423";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ===== Firma del JWT de App Store Connect (ES256) y llamadas a su API =====
// Apple exige ES256 (ECDSA P-256 + SHA-256) -- distinto del RS256 que ya se
// usa para el service account de Firebase en revisar-alertas-presupuesto,
// pero mismo patrón general de "Service Account JWT" con Web Crypto nativo
// de Deno, sin librería extra.
function base64UrlDesdeBytes(bytes: Uint8Array): string {
  let binario = "";
  bytes.forEach((b) => (binario += String.fromCharCode(b)));
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDesdeTexto(texto: string): string {
  return base64UrlDesdeBytes(new TextEncoder().encode(texto));
}

async function importarLlavePrivadaApple(pem: string): Promise<CryptoKey> {
  const cuerpo = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binario = atob(cuerpo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return crypto.subtle.importKey("pkcs8", bytes.buffer, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function firmarJWTAppStoreConnect(): Promise<string> {
  const keyId = Deno.env.get("APPLE_ASC_KEY_ID");
  const issuerId = Deno.env.get("APPLE_ASC_ISSUER_ID");
  const privateKeyPem = Deno.env.get("APPLE_ASC_PRIVATE_KEY");
  if (!keyId || !issuerId || !privateKeyPem) {
    throw new Error("Faltan las variables APPLE_ASC_KEY_ID / APPLE_ASC_ISSUER_ID / APPLE_ASC_PRIVATE_KEY");
  }
  const ahora = Math.floor(Date.now() / 1000);
  const header = base64UrlDesdeTexto(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  // Apple exige un exp de máximo 20 minutos desde iat para las keys de App
  // Store Connect API -- se usa 15 para dejar margen.
  const claims = base64UrlDesdeTexto(JSON.stringify({
    iss: issuerId,
    iat: ahora,
    exp: ahora + 60 * 15,
    aud: "appstoreconnect-v1",
  }));
  const llave = await importarLlavePrivadaApple(privateKeyPem);
  // A diferencia de RS256, Web Crypto ya entrega la firma ECDSA en el
  // formato "raw r||s" que pide JWS -- no hace falta convertir de DER.
  const firma = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    llave,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64UrlDesdeBytes(new Uint8Array(firma))}`;
}

async function llamarAppleAPI(jwt: string, path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const resp = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data };
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
    const jwtApple = await firmarJWTAppStoreConnect();

    // Paso 1: reutilizar la solicitud ONGOING existente, o crear una nueva
    // si esta app nunca tuvo una.
    const listaExistente = await llamarAppleAPI(
      jwtApple,
      `/v1/apps/${APPLE_APP_ID}/analyticsReportRequests?filter[accessType]=ONGOING`,
    );
    if (!listaExistente.ok) {
      return jsonResponse({ error: "apple_api_error", paso: "listar_solicitud", detalle: listaExistente }, 502);
    }
    const solicitudesExistentes = (listaExistente.data as { data?: { id: string }[] })?.data || [];
    let solicitudId: string;
    let solicitudReciénCreada = false;

    if (solicitudesExistentes.length > 0) {
      solicitudId = solicitudesExistentes[0].id;
    } else {
      const creada = await fetch(`https://api.appstoreconnect.apple.com/v1/analyticsReportRequests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwtApple}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            type: "analyticsReportRequests",
            attributes: { accessType: "ONGOING" },
            relationships: { app: { data: { type: "apps", id: APPLE_APP_ID } } },
          },
        }),
      });
      const creadaJson = await creada.json().catch(() => null);
      if (!creada.ok) {
        return jsonResponse({ error: "apple_api_error", paso: "crear_solicitud", detalle: creadaJson }, 502);
      }
      solicitudId = (creadaJson as { data: { id: string } }).data.id;
      solicitudReciénCreada = true;
    }

    // Paso 2: qué reportes (categorías) hay disponibles bajo esa solicitud.
    // Todavía NO se descargan segmentos/CSV -- ver nota al principio del
    // archivo sobre por qué este primer paso se queda aquí.
    const reportes = await llamarAppleAPI(jwtApple, `/v1/analyticsReportRequests/${solicitudId}/reports?limit=50`);
    if (!reportes.ok) {
      return jsonResponse({ error: "apple_api_error", paso: "listar_reportes", detalle: reportes }, 502);
    }
    const listaReportes = ((reportes.data as { data?: { id: string; attributes?: { name?: string; category?: string } }[] })?.data || [])
      .map((r) => ({ id: r.id, nombre: r.attributes?.name ?? null, categoria: r.attributes?.category ?? null }));

    return jsonResponse({
      solicitudId,
      solicitudReciénCreada,
      avisoPrimeraVez: solicitudReciénCreada
        ? "Se acaba de crear la solicitud de analítica para esta app. Apple tarda 24-48 horas en generar los primeros datos -- vuelve a intentarlo mañana."
        : null,
      reportesDisponibles: listaReportes,
    });
  } catch (e) {
    console.error("panel-admin-apple-analytics: error:", e);
    const detalle = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "internal_error", detalle }, 500);
  }
});
