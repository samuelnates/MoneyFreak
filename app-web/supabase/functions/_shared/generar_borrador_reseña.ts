// Borrador de respuesta a reseñas de App Store, generado por IA -- parte
// 208, pedido explícito del usuario: "cada vez que detectes que hay una
// nueva opinión, manda una consulta con la API de OpenAI... y me la pones
// pre cargada en el panel de resumen diario para que solamente yo llegue y
// le pique enviar".
//
// Solo redacta texto -- nunca publica nada por su cuenta. responderReseñaApple
// (en apple_reviews.ts) sigue siendo la única función que habla con Apple
// para publicar una respuesta, y solo se llama cuando un admin le da clic al
// botón "Responder" en el panel con el texto (editado o no) que quedó en el
// <textarea>.
//
// Para no gastar una llamada a OpenAI cada vez que corre el cron (una vez al
// día) por cada reseña que sigue sin contestar, se reutiliza el borrador ya
// guardado de la corrida anterior si la reseña sigue sin respuesta -- solo
// se genera uno nuevo la primera vez que se ve esa reseña sin contestar.

import OpenAI from "npm:openai@4";
import type { ReseñaApple, ResultadoReseñasApple } from "./apple_reviews.ts";

const MODEL = "gpt-5.4-mini-2026-03-17";

const INSTRUCCIONES = `Eres parte del equipo de Money Freak, una app de finanzas personales, y vas a redactar una respuesta PÚBLICA a una reseña real del App Store (la respuesta la ve cualquiera que abra la ficha de la app).

Escribe una respuesta breve (2 a 4 oraciones), cálida y genuina, en el MISMO idioma en el que está escrita la reseña. Agradece el tiempo que se tomó la persona. Si menciona algo específico (una función que le gustó, un problema, una sugerencia), reconócelo puntualmente en vez de responder en genérico. Si la reseña es negativa o reporta un problema, discúlpate brevemente y sé constructivo, sin prometer fechas ni funciones concretas que no puedas garantizar. Usa como máximo un emoji, y solo si encaja con el tono. Nunca repitas el título de la reseña de forma literal. Firma como "El equipo de Money Freak" (o su equivalente natural en el idioma de la reseña). Responde solo con el texto de la respuesta -- sin comillas, sin explicaciones, sin encabezados.`;

async function generarUnBorrador(reseña: ReseñaApple, openai: OpenAI): Promise<string | null> {
  try {
    const input = JSON.stringify({
      calificacion: reseña.rating,
      titulo: reseña.titulo,
      cuerpo: reseña.cuerpo,
      autor: reseña.autor,
      territorio: reseña.territorio,
    });
    const resp = await openai.responses.create({ model: MODEL, instructions: INSTRUCCIONES, input });
    const texto = resp.output_text?.trim();
    return texto || null;
  } catch (e) {
    console.error(`generar_borrador_reseña: fallo generando borrador para reseña ${reseña.id}:`, e);
    return null;
  }
}

export async function agregarBorradoresIA(
  resultado: ResultadoReseñasApple,
  previas: ReseñaApple[] | null | undefined,
): Promise<ResultadoReseñasApple> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
  const previasPorId = new Map((previas || []).map((r) => [r.id, r]));

  const reseñas = await Promise.all(
    resultado.reseñas.map(async (r): Promise<ReseñaApple> => {
      if (r.tieneRespuesta) return { ...r, borrador: null };
      const previa = previasPorId.get(r.id);
      if (previa?.borrador) return { ...r, borrador: previa.borrador };
      if (!openai) return { ...r, borrador: null };
      const borrador = await generarUnBorrador(r, openai);
      return { ...r, borrador };
    }),
  );

  return { ...resultado, reseñas };
}
