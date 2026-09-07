// Reseñas y calificación reales de App Store Connect -- parte 200, pedido
// explícito del usuario: "trae nuevas funciones que te permite Apple al
// panel y que tu api key es de administrador". Leer/responder reseñas
// exige un rol elevado (Admin o Marketing) -- el mismo tipo de permiso que
// ya se confirmó necesario para crear la solicitud de analítica (parte
// 193), así que se reutiliza la misma llave.
//
// Dos fuentes combinadas:
// 1) El promedio/conteo de calificación PÚBLICO y agregado (todas las
//    versiones) viene del endpoint público de iTunes Lookup -- no necesita
//    JWT ni rol especial, y es el número "oficial" que ve cualquiera en la
//    ficha. La API de reseñas de App Store Connect NO expone ese agregado
//    directamente, solo reseñas individuales paginadas.
// 2) El texto de las reseñas recientes (para ver qué dice la gente de
//    verdad, y detectar cuáles no tienen respuesta) sí viene de la API de
//    App Store Connect, que exige el JWT firmado con la llave de rol
//    Admin.

import { APPLE_APP_ID, firmarJWTAppStoreConnect, llamarAppleAPI } from "./apple_analytics.ts";

export type ReseñaApple = {
  id: string;
  rating: number | null;
  titulo: string | null;
  cuerpo: string | null;
  autor: string | null;
  territorio: string | null;
  creadaEn: string | null;
  tieneRespuesta: boolean;
};

export type ResultadoReseñasApple = {
  ratingPublico: { promedio: number | null; totalCalificaciones: number | null } | null;
  reseñas: ReseñaApple[];
};

// Endpoint público de iTunes -- sin JWT. Si Apple cambia el shape o falla,
// se regresa null en vez de tronar todo el refresco (esto es un "extra",
// no el dato principal).
async function obtenerRatingPublico(): Promise<{ promedio: number | null; totalCalificaciones: number | null } | null> {
  try {
    const resp = await fetch(`https://itunes.apple.com/lookup?id=${APPLE_APP_ID}`);
    if (!resp.ok) return null;
    const json = await resp.json();
    const app = json?.results?.[0];
    if (!app) return null;
    return {
      promedio: typeof app.averageUserRating === "number" ? app.averageUserRating : null,
      totalCalificaciones: typeof app.userRatingCount === "number" ? app.userRatingCount : null,
    };
  } catch {
    return null;
  }
}

export async function obtenerReseñasApple(limite = 20): Promise<ResultadoReseñasApple> {
  const [ratingPublico, jwt] = await Promise.all([obtenerRatingPublico(), firmarJWTAppStoreConnect()]);

  const resp = await llamarAppleAPI(jwt, `/v1/apps/${APPLE_APP_ID}/customerReviews?limit=${limite}&sort=-createdDate&include=response`);
  if (!resp.ok) {
    throw new Error(`apple_api_error en listar_reseñas: ${JSON.stringify(resp).slice(0, 500)}`);
  }
  const data = (resp.data as { data?: unknown[]; included?: { type?: string; relationships?: { review?: { data?: { id?: string } } } }[] }) || {};
  const filas = data.data || [];
  // Las respuestas vienen en "included" como recurso aparte, ligadas a la
  // reseña por relación -- se arma un set de qué reseñas ya tienen
  // respuesta en vez de asumir un campo plano (el shape real nunca se pudo
  // confirmar en vivo desde el sandbox de desarrollo, mismo patrón que el
  // resto de esta integración).
  const idsConRespuesta = new Set(
    (data.included || [])
      .filter((inc) => inc.type === "customerReviewResponses")
      .map((inc) => inc.relationships?.review?.data?.id)
      .filter((id): id is string => !!id),
  );

  const reseñas: ReseñaApple[] = filas.map((f) => {
    const fila = f as { id: string; attributes?: { rating?: number; title?: string; body?: string; reviewerNickname?: string; territory?: string; createdDate?: string } };
    return {
      id: fila.id,
      rating: fila.attributes?.rating ?? null,
      titulo: fila.attributes?.title ?? null,
      cuerpo: fila.attributes?.body ?? null,
      autor: fila.attributes?.reviewerNickname ?? null,
      territorio: fila.attributes?.territory ?? null,
      creadaEn: fila.attributes?.createdDate ?? null,
      tieneRespuesta: idsConRespuesta.has(fila.id),
    };
  });

  return { ratingPublico, reseñas };
}

// Responder una reseña es una acción PÚBLICA (la respuesta la ve cualquiera
// en el App Store) -- por eso vive separada de la lectura, se llama solo
// cuando alguien le da clic al botón en el panel (nunca automático desde el
// cron), y exige el mismo rol Admin/Marketing.
export async function responderReseñaApple(reviewId: string, texto: string): Promise<void> {
  const jwt = await firmarJWTAppStoreConnect();
  const resp = await fetch(`https://api.appstoreconnect.apple.com/v1/customerReviewResponses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        type: "customerReviewResponses",
        attributes: { responseBody: texto },
        relationships: { review: { data: { type: "customerReviews", id: reviewId } } },
      },
    }),
  });
  if (!resp.ok) {
    const detalle = await resp.json().catch(() => null);
    throw new Error(`apple_api_error en responder_reseña: ${JSON.stringify(detalle).slice(0, 500)}`);
  }
}
