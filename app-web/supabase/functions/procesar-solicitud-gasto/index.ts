// Edge Function: procesar-solicitud-gasto
//
// Recibe una foto de un ticket, usa OpenAI para extraer un gasto estructurado
// (monto, categoría, subcategoría, nota, fecha), y lo guarda como una fila
// PENDIENTE en solicitudes_gasto_pendientes. Nunca escribe directo en
// `gastos` — el usuario tiene que aprobarla desde la app.
//
// La captura por voz vivía aquí también, pero se retiró: ahora una nota de
// voz se conversa directo con Freaky (preguntar-sobre-app), que transcribe y
// confirma en el momento — no necesita pasar por la cola de Aprobaciones.

import { createClient } from "npm:@supabase/supabase-js@2";
import OpenAI from "npm:openai@4";
import { zodTextFormat } from "npm:openai@4/helpers/zod";
import { z } from "npm:zod@3";
import { CATALOGO_GASTOS, CATEGORIAS_VALIDAS, EJEMPLOS_CATEGORIZACION, fechaValidaOAhora, hoyISO, type MedioPagoDisponible } from "../_shared/gastos.ts";

const MODEL_TEXTO = "gpt-5.4-mini-2026-03-17";

// Control de acceso por código de canje, temporalmente desactivado
// (2026-08-27): se abrió el acceso a todos los usuarios sin necesitar
// canjear un código. Si el uso satura la cuenta de OpenAI, se reactiva
// cambiando esto a `true` y volviendo a desplegar -- no hace falta
// reescribir nada más, el resto del control de acceso sigue intacto.
const GATE_CODIGO_IA_ACTIVO = false;

const SolicitudGastoSchema = z.object({
  monto: z.number().nullable(),
  categoria: z.enum(CATEGORIAS_VALIDAS as [string, ...string[]]).nullable(),
  subcategoria: z.string().nullable(),
  nota: z.string().nullable(),
  fecha: z.string().nullable(),
  medio_pago: z.string().nullable(),
  es_compra_meses: z.boolean(),
  es_recurrente: z.boolean(),
  meses: z.number().int().nullable(),
  confianza: z.enum(["alta", "media", "baja"]),
});

function construirPrompt(mediosPago: MedioPagoDisponible[]): string {
  const listaMediosPago = mediosPago.length
    ? mediosPago.map((m) => `- "${m.valor}" = ${m.etiqueta}`).join("\n")
    : `- "efectivo" = efectivo`;

  return `Extraes datos de un gasto personal a partir de una foto de un ticket/recibo.

Categorías válidas (usa exactamente uno de estos textos, o null si no aplica ninguno):
${CATEGORIAS_VALIDAS.map((c) => `- ${c}: ${CATALOGO_GASTOS[c].join(", ")}`).join("\n")}

${EJEMPLOS_CATEGORIZACION}

Medios de pago válidos (usa exactamente el "valor" entre comillas, o null si no se menciona ninguno):
${listaMediosPago}

REGLAS:
- monto: el monto total pagado, como número. Si mencionan un pago mensual de una compra a meses, usa el monto POR MES aquí (no el total). Si no está claro, usa null.
- categoria: usa el contexto completo (comercio, tipo de producto, lo que se compró) para elegir la categoría más probable de la lista de arriba, apoyándote en los ejemplos. No dejes categoria en null solo por no estar 100% seguro — da tu mejor estimación razonable y baja "confianza" en su lugar. Usa null solo si de verdad no hay ninguna pista de qué se compró.
- subcategoria: idealmente una de las subcategorías listadas para esa categoría; si no encaja ninguna, describe brevemente el concepto en 2-4 palabras.
- nota: una nota corta y útil (ej. nombre del comercio), o null.
- fecha: formato YYYY-MM-DD si se menciona una fecha específica, o null si no se menciona (se asume hoy).
- medio_pago: si la persona menciona cómo pagó (ej. "con mi tarjeta BBVA", "en efectivo", "con mi débito de Santander"), usa el "valor" exacto del medio de pago que mejor coincida de la lista de arriba. Si no se menciona o no coincide claramente con ninguno, usa null — no adivines.
- es_compra_meses: true SOLO si mencionan explícitamente que es una compra en pagos/plazos — "a meses", "meses sin intereses", "MSI", "en 3/6/12 pagos", "lo diferí". Si es true y mencionan cuántos meses, pon ese número en "meses" (si dicen "meses sin intereses" sin especificar, usa 12). Si no mencionan nada de esto, es_compra_meses debe ser false.
- es_recurrente: true si describen el gasto como algo que se repite cada mes (colegiatura, membresía, suscripción, renta) pero SIN mencionar que es una compra a plazos — es un concepto distinto a es_compra_meses, nunca ambos true a la vez. Si es true, "meses" es cuántos meses van a repetirlo si lo mencionan, o null si no lo dicen.
- confianza: "alta" si el monto y la categoría son claros, "media" si hay algo de ambigüedad, "baja" si estás adivinando bastante.
- No inventes montos ni fechas que no estén presentes.
- Devuelve exclusivamente el JSON del esquema.`;
}

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

function conTimeout<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(mensaje)), ms)
  );
  return Promise.race([promesa, timeout]);
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

  // Mismo control de acceso que la radiografía: cualquier llamada aquí cuesta OpenAI.
  if (GATE_CODIGO_IA_ACTIVO) {
    const { data: acceso, error: accesoError } = await admin
      .from("accesos_ia_usuarios")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (accesoError) {
      console.error("Error verificando acceso:", accesoError);
      return jsonResponse({ error: "access_check_failed" }, 500);
    }
    if (!acceso) {
      return jsonResponse({ error: "sin_acceso" }, 403);
    }
  }

  let body: {
    tipo?: string;
    datos_base64?: string;
    mime_type?: string;
    medios_pago_disponibles?: MedioPagoDisponible[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }
  const { tipo, datos_base64, mime_type } = body;
  if (tipo !== "foto") {
    return jsonResponse({ error: "invalid_tipo" }, 400);
  }
  if (!datos_base64 || !mime_type) {
    return jsonResponse({ error: "missing_datos" }, 400);
  }
  const mediosPago = Array.isArray(body.medios_pago_disponibles) ? body.medios_pago_disponibles : [];
  const SYSTEM_PROMPT = construirPrompt(mediosPago);
  const valoresValidos = new Set(mediosPago.length ? mediosPago.map((m) => m.valor) : ["efectivo"]);

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const openai = new OpenAI({ apiKey: openaiKey });

  try {
    const textoFuente = "[foto de ticket]";
    const response = await conTimeout(
      openai.responses.parse({
        model: MODEL_TEXTO,
        store: false,
        instructions: SYSTEM_PROMPT,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: `Fecha de hoy: ${hoyISO()}. Extrae el gasto de esta foto de ticket/recibo.` },
              { type: "input_image", image_url: `data:${mime_type};base64,${datos_base64}`, detail: "low" },
            ],
          },
        ],
        text: { format: zodTextFormat(SolicitudGastoSchema, "solicitud_gasto") },
      }),
      25000,
      "openai_extraccion_timeout_25s"
    );
    const parsed = response.output_parsed;

    if (!parsed) throw new Error("empty_output_parsed");

    // Nunca confiar ciegamente en el medio_pago que devuelve el modelo: solo se
    // guarda si coincide exactamente con una de las opciones reales que se le dieron.
    const medioPagoValidado = parsed.medio_pago && valoresValidos.has(parsed.medio_pago)
      ? parsed.medio_pago
      : null;

    const { data: fila, error: insertError } = await admin
      .from("solicitudes_gasto_pendientes")
      .insert({
        user_id: userId,
        tipo,
        estado: "pendiente",
        monto_sugerido: parsed.monto,
        categoria_sugerida: parsed.categoria,
        subcategoria_sugerida: parsed.subcategoria,
        nota_sugerida: parsed.nota,
        fecha_sugerida: fechaValidaOAhora(parsed.fecha),
        medio_pago_sugerido: medioPagoValidado,
        es_compra_meses: parsed.es_compra_meses,
        es_recurrente: parsed.es_recurrente,
        meses_sugeridos: parsed.meses,
        texto_fuente: textoFuente,
        confianza: parsed.confianza,
      })
      .select()
      .single();
    if (insertError) {
      console.error("Error guardando solicitud:", insertError);
      return jsonResponse({ error: "save_failed" }, 500);
    }

    return jsonResponse({ solicitud: fila });
  } catch (e) {
    console.error("Error procesando solicitud de gasto:", e);
    // TODO: quitar "detail" una vez diagnosticado — temporal, para ver el error
    // real sin acceso a los logs del servidor.
    const detail = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "processing_failed", detail }, 500);
  }
});
