// Edge Function: radiografia-mensual
//
// Recibe un snapshot financiero YA CALCULADO por el cliente (index.html:
// construirSnapshotFinanciero()), verifica la sesión del usuario, llama a
// OpenAI solo para interpretar/redactar (nunca para calcular cifras), valida
// la respuesta contra el schema con Zod, y la guarda en `reportes_financieros`.
//
// Ninguna cifra crítica depende del LLM: todo lo que aparece en kpis/scenarios
// viene del snapshot que el cliente ya calculó con las funciones existentes de
// la app (calcularBalance, calcularSaludFinanciera, calcularGastosMes,
// calcularFlujoEfectivo).

import { createClient } from "npm:@supabase/supabase-js@2";
import OpenAI from "npm:openai@4";
import { zodTextFormat } from "npm:openai@4/helpers/zod";
import { z } from "npm:zod@3";

const MODEL = "gpt-5.4-mini-2026-03-17";

// Control de acceso por código de canje, temporalmente desactivado
// (2026-08-27): se abrió el acceso a todos los usuarios sin necesitar
// canjear un código. Si el uso satura la cuenta de OpenAI, se reactiva
// cambiando esto a `true` y volviendo a desplegar -- no hace falta
// reescribir nada más, el resto del control de acceso sigue intacto.
const GATE_CODIGO_IA_ACTIVO = false;

const SYSTEM_PROMPT = `Eres el analista financiero de Money Freak.

Tu función es interpretar indicadores calculados por el backend y convertirlos en un diagnóstico financiero claro para principiantes.

REGLAS:
- No alteres ni recalcules cifras proporcionadas como definitivas.
- Separa hechos, inferencias, anomalías y escenarios.
- No presentes una proyección como certeza.
- No corrijas datos silenciosamente.
- Cuando haya inconsistencias, conserva el valor original, propone una corrección y solicita confirmación.
- Prioriza liquidez, pagos próximos, flujo de efectivo, deuda y calidad de datos.
- No confundas transferencias con ingresos o gastos.
- No dupliques compras y pagos de tarjeta.
- No consideres bienes físicos o fondos de retiro como efectivo disponible.
- Explica todo en español sencillo.
- No recomiendes instrumentos financieros específicos sin información suficiente.
- No inventes tasas, rendimientos, fechas o datos externos.
- Los escenarios de flujo (cashflow_scenarios) que recibes ya vienen calculados por el backend — tu trabajo es explicarlos, no recalcularlos ni inventar otros.
- El mes en curso NUNCA está terminado: revisa el bloque "contexto_temporal" del snapshot (día del mes actual, días totales del mes, % transcurrido) y trata la última entrada de "comparativo_historico_6m" (marcada con "indice_mes_actual_incompleto"/"nota_mes_en_curso") como un acumulado PARCIAL, no un mes cerrado. Nunca compares el gasto del mes en curso contra un mes anterior ya completo sin aclarar en qué día del mes va -- decir que "va mejor" o "va peor" solo por esa diferencia sin esa aclaración es un diagnóstico engañoso.
- Devuelve exclusivamente el JSON definido por el esquema.`;

const AlertSchema = z.object({
  id: z.string(),
  severity: z.enum(["healthy", "attention", "risk"]),
  title: z.string(),
  explanation: z.string(),
  evidence: z.array(z.string()).max(3),
  proposed_action: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
});

const ScenarioSchema = z.object({
  name: z.string(),
  minimum_balance: z.number(),
  minimum_date: z.string(),
  ending_balance: z.number(),
  first_negative_date: z.string().nullable(),
  assumptions: z.array(z.string()),
});

const ActionPlanItemSchema = z.object({
  priority: z.number().int(),
  deadline_days: z.number().int(),
  action: z.string(),
  estimated_impact: z.number().nullable(),
});

const CorrectionSchema = z.object({
  record_type: z.string(),
  date: z.string(),
  concept: z.string(),
  current_value: z.string(),
  suggested_value: z.string(),
  reason: z.string(),
  estimated_impact: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  requires_confirmation: z.boolean(),
});

const MoneyFreakReportSchema = z.object({
  meta: z.object({
    schema_version: z.string(),
    cut_date: z.string(),
    currency: z.string(),
  }),
  data_quality: z.object({
    grade: z.enum(["A", "B", "C", "D", "E"]),
    explanation: z.string(),
    issues: z.array(z.string()),
  }),
  kpis: z.object({
    gross_assets: z.number(),
    total_debt: z.number(),
    net_worth: z.number(),
    liquidity: z.number(),
    free_liquidity: z.number(),
    monthly_income: z.number(),
    corrected_budget: z.number(),
    corrected_margin: z.number(),
  }),
  diagnosis: z.object({
    summary: z.string().max(600),
    facts: z.array(z.string()),
    inferences: z.array(z.string()),
  }),
  alerts: z.array(AlertSchema).max(7),
  scenarios: z.array(ScenarioSchema).max(6),
  action_plan: z.array(ActionPlanItemSchema).max(5),
  corrections: z.array(CorrectionSchema),
});

const PROMPT_VERSION = "1.0";
const SCHEMA_VERSION = "1.0";

// CORS: el navegador manda un preflight OPTIONS antes del POST real porque la
// petición cruza de moneyfreak.app a *.supabase.co con headers custom
// (Authorization, Content-Type). Sin esto, el navegador bloquea la petición
// antes de que la función siquiera la vea.
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

Deno.serve(async (req) => {
  console.log(`[1] Invocación recibida: ${req.method}`);
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
  console.log(`[2] SUPABASE_URL presente: ${!!supabaseUrl}, SERVICE_ROLE_KEY presente: ${!!serviceRoleKey}`);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // 1. Verificar el JWT del usuario (nunca confiar en un user_id que mande el cliente)
  console.log("[3] Verificando JWT...");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  console.log(`[4] JWT verificado. error=${userError ? userError.message : "ninguno"}, user=${userData?.user?.id ?? "ninguno"}`);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "invalid_session" }, 401);
  }
  const userId = userData.user.id;

  let body: { snapshot?: Record<string, unknown>; regenerate?: boolean; regenerate_keyword?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }
  console.log(`[5] Body parseado. snapshot presente: ${!!body.snapshot}, regenerate: ${!!body.regenerate}`);
  if (!body.snapshot || typeof body.snapshot !== "object") {
    return jsonResponse({ error: "missing_snapshot" }, 400);
  }

  // 1b. Control de acceso: solo usuarios que canjearon un código pueden usar
  // esta función (cada llamada, cacheada o no, cuesta o costó dinero real).
  console.log("[3b] Verificando acceso a la función de IA...");
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

  const cutDate = String(body.snapshot.fecha_corte || new Date().toISOString().slice(0, 10));
  const reportMonth = `${cutDate.slice(0, 7)}-01`;
  console.log(`[6] reportMonth calculado: ${reportMonth}`);

  // 2. Buscar reporte existente del mes (idempotencia, y para decidir si hace
  // falta la palabra clave de regenerar).
  console.log("[7] Buscando reporte existente...");
  const { data: existente, error: existenteError } = await admin
    .from("reportes_financieros")
    .select("*")
    .eq("user_id", userId)
    .eq("report_month", reportMonth)
    .eq("report_version", 1)
    .eq("status", "completed")
    .not("report_json", "is", null)
    .maybeSingle();
  console.log(`[8] Búsqueda de reporte existente terminó. error=${existenteError ? existenteError.message : "ninguno"}, encontrado=${!!existente}`);
  if (existenteError) {
    console.error("[8b] Error consultando reportes_financieros:", existenteError);
    return jsonResponse({ error: "lookup_failed", detail: existenteError.message }, 500);
  }
  if (existente && !body.regenerate) {
    return jsonResponse({ report: existente.report_json, cached: true });
  }
  if (existente && body.regenerate) {
    const regenKeyword = Deno.env.get("RADIOGRAFIA_REGEN_KEYWORD");
    const normalizar = (s: string) => s.trim().toLowerCase();
    if (!regenKeyword || !body.regenerate_keyword || normalizar(body.regenerate_keyword) !== normalizar(regenKeyword)) {
      console.log("[8c] Palabra clave de regenerar ausente o incorrecta.");
      return jsonResponse({ error: "wrong_keyword" }, 403);
    }
  }
  console.log("[9] Sin reporte existente o regeneración autorizada, procediendo a llamar a OpenAI...");

  // 3. Llamada a OpenAI — solo interpretación, cifras vienen ya calculadas en el snapshot
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const openai = new OpenAI({ apiKey: openaiKey });

  let parsed;
  try {
    console.log(`Llamando a OpenAI (modelo ${MODEL})...`);
    const openaiCall = openai.responses.parse({
      model: MODEL,
      store: false,
      instructions: SYSTEM_PROMPT,
      input: JSON.stringify(body.snapshot),
      text: {
        format: zodTextFormat(MoneyFreakReportSchema, "money_freak_monthly_report"),
      },
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("openai_timeout_60s")), 60000)
    );
    const response = await Promise.race([openaiCall, timeout]);
    console.log("OpenAI respondió.");
    parsed = response.output_parsed;
    if (!parsed) throw new Error("empty_output_parsed");

    // 4. Guardar (upsert por si regenerate=true pisa el reporte del mes)
    const { error: insertError } = await admin.from("reportes_financieros").upsert(
      {
        user_id: userId,
        report_month: reportMonth,
        report_version: 1,
        schema_version: SCHEMA_VERSION,
        prompt_version: PROMPT_VERSION,
        status: "completed",
        model: MODEL,
        input_tokens: response.usage?.input_tokens ?? null,
        cached_input_tokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
        report_json: parsed,
      },
      { onConflict: "user_id,report_month,report_version" },
    );
    if (insertError) {
      console.error("Error guardando reporte:", insertError);
      return jsonResponse({ error: "save_failed" }, 500);
    }

    return jsonResponse({ report: parsed, cached: false });
  } catch (e) {
    console.error("Error generando radiografía:", e);
    await admin.from("reportes_financieros").upsert(
      {
        user_id: userId,
        report_month: reportMonth,
        report_version: 1,
        schema_version: SCHEMA_VERSION,
        prompt_version: PROMPT_VERSION,
        status: "error",
        error_code: e instanceof Error ? e.message.slice(0, 200) : "unknown_error",
      },
      { onConflict: "user_id,report_month,report_version" },
    );
    return jsonResponse({ error: "generation_failed" }, 500);
  }
});
