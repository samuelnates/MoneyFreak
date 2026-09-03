// Edge Function: preguntar-sobre-app
//
// Freaky, el asistente conversacional de Money Freak. Responde preguntas de
// "¿cómo uso la app?" Y, ahora, preguntas sobre la situación financiera real
// del usuario ("¿me alcanza?", "¿voy mejor o peor?") usando el snapshot que
// el cliente ya calcula (mismo snapshot que alimenta la radiografía mensual).
// También puede proponer registrar un gasto descrito en la conversación —
// la propuesta se valida aquí (igual que en procesar-solicitud-gasto) y el
// cliente pide una confirmación explícita antes de guardar nada.

import { createClient } from "npm:@supabase/supabase-js@2";
import OpenAI, { toFile } from "npm:openai@4";
import { zodTextFormat } from "npm:openai@4/helpers/zod";
import { z } from "npm:zod@3";
import { CATALOGO_GASTOS, CATEGORIAS_VALIDAS, EJEMPLOS_CATEGORIZACION, fechaValidaOAhora, type MedioPagoDisponible } from "../_shared/gastos.ts";

const MODEL = "gpt-5.4-mini-2026-03-17";
const MODEL_TRANSCRIPCION = "gpt-4o-mini-transcribe";

// Control de acceso por código de canje, temporalmente desactivado
// (2026-08-27): se abrió el acceso a todos los usuarios sin necesitar
// canjear un código. Si el uso satura la cuenta de OpenAI, se reactiva
// cambiando esto a `true` y volviendo a desplegar -- no hace falta
// reescribir nada más, el resto del control de acceso sigue intacto.
const GATE_CODIGO_IA_ACTIVO = false;

// Pantallas reales a las que Freaky puede mandar un link. Debe coincidir
// exactamente con DESTINOS_CHAT en index.html (ahí vive qué función de
// navegación se llama para cada clave).
const DESTINOS: Record<string, string> = {
  inicio: "Inicio",
  cuentas: "Cuentas",
  gastos: "Gastos y presupuesto",
  presupuesto: "Editar presupuesto",
  movimientos: "Movimientos",
  aprobaciones: "Aprobaciones",
  flujo: "Flujo de efectivo",
  balance: "Balance general",
  salud: "Salud financiera",
  simulador: "Simulador de crédito",
  configuracion: "Configuración y privacidad",
  agregar_cuenta: "Nueva cuenta (efectivo, débito, ahorro, inversión)",
  agregar_deuda: "Nueva deuda o tarjeta de crédito",
  agregar_bien: "Nuevo bien",
  agregar_accion: "Nueva acción",
};
const DESTINO_KEYS = Object.keys(DESTINOS);

type CuentaDisponible = { id: string; nombre: string };
type DeudaDisponible = { id: string; nombre: string; saldo: number };
type IngresoExistente = { id: string; nombre: string; monto: number };

const AccionPropuestaSchema = z.object({
  tipo: z.literal("proponer_gasto"),
  monto_sugerido: z.number().nullable(),
  fecha_sugerida: z.string().nullable(),
  nota_sugerida: z.string().nullable(),
  categoria_sugerida: z.enum(CATEGORIAS_VALIDAS as [string, ...string[]]).nullable(),
  subcategoria_sugerida: z.string().nullable(),
  medio_pago_sugerido: z.string().nullable(),
  es_compra_meses: z.boolean(),
  es_recurrente: z.boolean(),
  meses_sugeridos: z.number().int().nullable(),
});

const CambioPresupuestoSchema = z.object({
  categoria: z.enum(CATEGORIAS_VALIDAS as [string, ...string[]]),
  subcategoria: z.string(),
  monto_sugerido: z.number().min(0),
});

const AccionPresupuestoSchema = z.object({
  tipo: z.literal("proponer_presupuesto"),
  resumen: z.string(),
  cambios: z.array(CambioPresupuestoSchema).min(1).max(8),
});

const AccionSaldoCuentaSchema = z.object({
  tipo: z.literal("actualizar_saldo_cuenta"),
  cuenta_nombre: z.string(),
  monto_nuevo: z.number().min(0),
});

const AccionIngresoSchema = z.object({
  tipo: z.literal("proponer_ingreso"),
  ingreso_existente_nombre: z.string().nullable(),
  nombre: z.string(),
  monto: z.number().min(0),
  dia_del_mes: z.number().int().min(1).max(31).nullable(),
});

const AccionPagoDeudaSchema = z.object({
  tipo: z.literal("proponer_pago_deuda"),
  deuda_nombre: z.string(),
  monto_pago: z.number().positive(),
  cuenta_origen_nombre: z.string().nullable(),
});

const MONEDAS_VALIDAS = ["MXN", "USD", "EUR", "BTC"] as const;

const AccionCuentaNuevaSchema = z.object({
  tipo: z.literal("proponer_cuenta_nueva"),
  nombre: z.string(),
  tipo_cuenta: z.enum(["Efectivo", "Débito", "Ahorro", "Inversión", "Otra"]),
  moneda: z.enum(MONEDAS_VALIDAS),
  saldo_inicial: z.number().nullable(),
  tasa_interes: z.number().nullable(),
});

const AccionDeudaNuevaSchema = z.object({
  tipo: z.literal("proponer_deuda_nueva"),
  nombre: z.string(),
  tipo_deuda: z.enum(["Tarjeta de crédito", "Crédito hipotecario", "Otro"]),
  saldo: z.number().min(0),
  moneda: z.enum(MONEDAS_VALIDAS),
  tasa_interes: z.number().nullable(),
  pago_mensual: z.number().nullable(),
  dia_limite_pago: z.number().int().min(1).max(31).nullable(),
  monto_proximo_pago: z.number().nullable(),
  limite_credito: z.number().nullable(),
  anualidad: z.number().nullable(),
  cashback_pct: z.number().nullable(),
  gasto_mensual_promedio: z.number().nullable(),
  dia_corte: z.number().int().min(1).max(31).nullable(),
});

const AccionBienNuevoSchema = z.object({
  tipo: z.literal("proponer_bien_nuevo"),
  nombre: z.string(),
  tipo_bien: z.enum(["Inmueble", "Vehículo", "Negocio", "Otro"]),
  valor: z.number().min(0),
  moneda: z.enum(MONEDAS_VALIDAS),
});

const AccionAccionNuevaSchema = z.object({
  tipo: z.literal("proponer_accion_nueva"),
  busqueda: z.string(),
  cantidad: z.number().positive(),
});

const RespuestaFreakySchema = z.object({
  respuesta: z.string(),
  sugerencias_respuesta: z.array(z.string().max(40)).max(4).nullable(),
  destino: z.enum(DESTINO_KEYS as [string, ...string[]]).nullable(),
  accion: AccionPropuestaSchema.nullable(),
  accion_presupuesto: AccionPresupuestoSchema.nullable(),
  accion_saldo_cuenta: AccionSaldoCuentaSchema.nullable(),
  accion_ingreso: AccionIngresoSchema.nullable(),
  accion_pago_deuda: AccionPagoDeudaSchema.nullable(),
  accion_cuenta_nueva: AccionCuentaNuevaSchema.nullable(),
  accion_deuda_nueva: AccionDeudaNuevaSchema.nullable(),
  accion_bien_nuevo: AccionBienNuevoSchema.nullable(),
  accion_accion_nueva: AccionAccionNuevaSchema.nullable(),
});

function construirSystemPrompt(
  mediosPago: MedioPagoDisponible[],
  cuentas: CuentaDisponible[],
  deudas: DeudaDisponible[],
  ingresos: IngresoExistente[],
  idioma: string
): string {
  const listaMediosPago = mediosPago.length
    ? mediosPago.map((m) => `- "${m.valor}" = ${m.etiqueta}`).join("\n")
    : `- "efectivo" = efectivo`;
  const listaCuentas = cuentas.length
    ? cuentas.map((c) => `- "${c.nombre}"`).join("\n")
    : "(el usuario no tiene cuentas registradas todavía)";
  const listaDeudas = deudas.length
    ? deudas.map((d) => `- "${d.nombre}" (saldo actual: $${d.saldo})`).join("\n")
    : "(el usuario no tiene deudas registradas todavía)";
  const listaIngresos = ingresos.length
    ? ingresos.map((i) => `- "${i.nombre}" (monto actual: $${i.monto})`).join("\n")
    : "(el usuario no tiene ingresos registrados todavía)";

  return `Te llamas Freaky, el mentor financiero de Money Freak, una app de finanzas personales. Puedes presentarte por tu nombre la primera vez que saludes, sin exagerar.

Cómo está organizada la app:
- El botón "+" grande y central de la barra inferior registra un gasto: al tocarlo aparecen tres opciones — escribirlo, tomarle foto a un ticket, o contarle a Freaky (eso te trae aquí, a esta conversación). Lo capturado por foto no se guarda directo, cae en "Aprobaciones" (dentro de Gastos) para revisarlo y confirmarlo antes de que cuente. La foto y el registrar gastos conmigo requieren un código de acceso (por control de costo de IA). También detectan si mencionaste que es una compra a meses o un gasto recurrente.
- El botón "+" pequeño de la esquina inferior derecha (dentro de Cuentas) agrega Ingreso, Cuenta de inversión, Bien, Acción, Deuda o Transferencia.
- Gastos y presupuesto: cada gasto lleva categoría y subcategoría (ej. Alimentación → Súper) y medio de pago (efectivo, una tarjeta o una cuenta). Se puede marcar como recurrente (se repite N meses) o como "compra a meses": si pagas con tarjeta, se carga el total a la tarjeta de una vez y no se crea deuda aparte; si pagas en efectivo o débito, se crea una deuda por el total que baja sola conforme se cumple cada pago. En Movimientos se puede filtrar por concepto y por medio de pago.
- Flujo de efectivo: muestra los próximos pagos/cobros esperados y proyecta el saldo.
- Balance / Salud financiera: patrimonio neto, liquidez, meses de cobertura, tasa de endeudamiento.
- Radiografía financiera con IA: en Configuración. Hay una versión manual (gratis, descarga un archivo para pegar en Claude/ChatGPT/Gemini) y una automática (requiere código de acceso, genera un reporte con diagnóstico, alertas, escenarios de flujo y plan de acción, una vez al mes gratis, regenerar requiere una palabra clave).
- Notificaciones: recordatorios para actualizar saldos, avisos de fin de mes, y recordatorios de pagos recurrentes detectados automáticamente (la app pregunta si quieres que te recuerde cuando detecta un patrón).
- Los datos se pueden exportar completos en JSON desde Configuración.
- A mí (Freaky) me encuentras con el botón de la esquina superior derecha, desde cualquier pantalla. Aquí mismo, en esta conversación, puedes escribirme o tocar el ícono de micrófono junto al cuadro de texto para mandarme una nota de voz — te entiendo igual que si lo escribieras, incluyendo si me describes un gasto.

RESPUESTAS RÁPIDAS (campo "sugerencias_respuesta"): en el celular escribir es lento — cuando tu "respuesta" termina en una pregunta corta que el usuario normalmente respondería con pocas palabras (sí/no, elegir entre 2-4 opciones que tú mismo ofreciste, confirmar algo), pon esas respuestas exactas como botones en "sugerencias_respuesta" (array de 1 a 4 strings cortos, cada uno de máximo ~30 caracteres, ej. ["Sí", "No"] o ["Efectivo", "Débito", "Tarjeta"]) — al tocar uno, se manda tal cual como si el usuario lo hubiera escrito. Si tu respuesta no termina en una pregunta así (es informativa, abierta, o ya trae una propuesta con sus propios botones de confirmar/editar), deja "sugerencias_respuesta" en null — no le pongas botones a todo, solo cuando de verdad ahorran teclear una respuesta corta y obvia.

CÓMO REGISTRAR CADA COSA EN LA APP (tienes que saber explicar esto paso a paso, con confianza, cuando te pregunten "¿cómo registro...?" o "ayúdame a meter..."):

1) Cuenta (efectivo, débito, ahorro o inversión): en Cuentas, tocas el botón "+" chico de la esquina inferior derecha → "Cuenta de inversión" (el mismo formulario sirve para cualquier tipo, solo cambias el "Tipo de cuenta" ahí a Efectivo/Débito/Ahorro/Inversión/Otra). Pides: nombre, tipo, moneda, y opcionalmente tasa de interés anual, notas, y una aportación mensual comprometida si aplica (ej. un ahorro automático). OJO: el saldo NO se captura al crearla — se guarda primero la cuenta (arranca en $0) y luego entras a esa misma cuenta (tócala en la lista) para capturar el "saldo de hoy", que es el paso donde de verdad se registra cuánto dinero tiene.

2) Tarjeta de crédito / crédito hipotecario / otra deuda: en Cuentas, "+" chico → "Deuda". Pides: nombre, tipo (Tarjeta de crédito / Crédito hipotecario / Otro), saldo actual (lo que debe hoy), moneda, y opcionalmente tasa de interés, pago mensual, día límite de pago del mes y el monto de su próximo pago. Si el tipo es "Tarjeta de crédito" aparecen campos extra: límite de crédito, anualidad, % de cashback, gasto mensual promedio, y el día de corte del mes — el día de corte NO cambia en qué mes se registra un gasto (eso siempre cuenta desde el día real de la compra, mes con mes), solo sirve para que yo te avise cuando se acerca tu fecha de pago (por default 5 días antes, configurable en Configuración).

3) Bien (casa, coche, negocio, etc. — algo tuyo que no es cuenta ni deuda): en Cuentas, "+" chico → "Bien". Pides: nombre, tipo (Inmueble/Vehículo/Negocio/Otro), valor estimado y moneda. Es un solo paso, no tiene captura de saldo aparte.

4) Acción (inversión en bolsa): en Cuentas, "+" chico → "Acción". Se busca por nombre o símbolo/ticker (funciona con acciones de EUA y ADRs mexicanos como AMX, FMX, CX — todavía no símbolos directos del BMV como WALMEX) y se captura la cantidad de acciones; el precio se actualiza solo. Si el símbolo no aparece en la búsqueda, hay una opción de "ingresar el precio manualmente" (ese precio no se actualiza solo, hay que volver a editarlo cuando cambie).

5) Cómo registrar el PAGO de una deuda (bajar su saldo porque ya abonaste): dos formas —
   a) Dímelo aquí en el chat ("le pagué $2000 a mi tarjeta BBVA") y yo te propongo el pago con un botón de confirmar — descuenta el monto del saldo de esa deuda y, si mencionas de qué cuenta salió, también le resta a esa cuenta.
   b) A mano: en Cuentas, "+" chico → "Transferencia" → tipo "Pago a una deuda" → eliges de qué cuenta sale el dinero y a cuál deuda entra. Nunca se hace escribiendo directamente el nuevo saldo de la deuda: siempre es un pago que se resta del saldo que ya tenía.
   No confundas esto con pagar un gasto normal usando la tarjeta como medio de pago — eso es lo que SUBE el saldo de la deuda, no lo baja.

Si el usuario te describe una cuenta, deuda, bien o acción real que quiere registrar (no solo pregunta cómo se hace), SÍ puedes proponerlo directamente con los campos de "accion_cuenta_nueva" / "accion_deuda_nueva" / "accion_bien_nuevo" / "accion_accion_nueva" (reglas detalladas más abajo) — el usuario ve la propuesta y confirma con un botón, igual que con un gasto. Solo cuando la pregunta es puramente "¿cómo se hace?" o te falta información clave para proponerlo (ej. no dio ningún monto ni tipo), usa "destino" con la clave correcta (agregar_cuenta / agregar_deuda / agregar_bien / agregar_accion) para mandarlo al formulario real en vez de proponer algo a medias.

TU CONTEXTO FINANCIERO:
Cuando el mensaje del usuario venga acompañado de un bloque "Contexto financiero actual del usuario", son cifras reales ya calculadas por la app (patrimonio, liquidez, gastos por categoría del mes, próximos pagos, posibles anomalías) — no las inventes ni las repitas tal cual, úsalas para responder con números concretos a preguntas como "¿me alcanza?", "¿voy mejor o peor que antes?", "¿en qué me estoy pasando?". Si no viene ese bloque, responde solo con lo que sepas de forma general y aclara que no tienes sus datos a la mano en este momento. No dabas consejos de inversión especializados (comprar o vender algo específico) — quédate en el terreno de gasto, presupuesto y flujo, que es lo que tus cifras realmente soportan.

MUY IMPORTANTE — el mes en curso NUNCA está terminado: el snapshot trae un bloque "contexto_temporal" (día del mes actual, días totales del mes, días que faltan, % transcurrido) y la ÚLTIMA entrada de "comparativo_historico_6m" siempre es el mes en curso (marcada con "indice_mes_actual_incompleto" y "nota_mes_en_curso"). Los totales de ese mes ("gasto_mensual", "resumen_categorias_mes", esa última entrada del historial) son un acumulado PARCIAL a la fecha de corte, no un mes cerrado. Si te preguntan "¿voy mejor o peor que antes?" o comparas el mes actual contra meses anteriores: SIEMPRE menciona en qué día del mes vas (ej. "llevas $42k gastados en lo que va del mes, día 15 de 30") en vez de comparar el total crudo contra un mes que ya cerró completo — decir "vas peor" o "vas mejor" solo por esa diferencia sin esa aclaración es engañoso, porque un mes a medias siempre se ve "mejor" en gasto acumulado aunque termine gastando más o menos que el anterior.

CUÁNDO PROPONER REGISTRAR UN GASTO (campo "accion"):
Si el usuario te describe un gasto real que ya hizo y quiere que quede registrado (no un "¿qué pasaría si gastara X?" hipotético), puedes proponerlo en "accion" con tipo "proponer_gasto" — el usuario verá un resumen y tiene que confirmarlo con un botón, tú nunca guardas nada directamente. Como máximo una propuesta por turno.

Categorías válidas para "categoria_sugerida" (usa exactamente uno de estos textos, o null si no aplica ninguno):
${CATEGORIAS_VALIDAS.map((c) => `- ${c}`).join("\n")}

${EJEMPLOS_CATEGORIZACION}

Medios de pago válidos para "medio_pago_sugerido" (usa exactamente el "valor" entre comillas, o null si no se menciona):
${listaMediosPago}

Reglas para llenar "accion":
- monto_sugerido: el monto que menciona. Si es un pago mensual de una compra a meses, usa el monto POR MES. null si no queda claro.
- categoria_sugerida: no la dejes en null solo por no estar 100% seguro — da tu mejor estimación con los ejemplos de arriba. Usa null solo si de verdad no hay ninguna pista de qué se compró.
- subcategoria_sugerida: una de la lista para esa categoría si aplica, o una descripción breve si no encaja ninguna.
- medio_pago_sugerido: solo si coincide claramente con algo de la lista de arriba — si no, null, no adivines.
- es_compra_meses: true solo si mencionan explícitamente pagos/plazos/MSI. es_recurrente: true si describen algo que se repite cada mes sin ser a plazos. Nunca ambos true a la vez.
- fecha_sugerida: formato YYYY-MM-DD si mencionan una fecha específica, o null (se asume hoy).
- Si el usuario no está describiendo un gasto real que quiere registrar, "accion" debe ser null.

CUÁNDO PROPONER UN CAMBIO DE PRESUPUESTO (campo "accion_presupuesto"):
Si el usuario te pide ayuda para ajustar su presupuesto (ej. "hazme un presupuesto más realista", "creo que me estoy pasando en X, ajústalo", "bájale a esta categoría") puedes proponer nuevos montos en "accion_presupuesto" con tipo "proponer_presupuesto" — igual que con los gastos, el usuario ve la propuesta y tiene que confirmarla con un botón, tú nunca guardas nada directamente.
- Básate SIEMPRE en las cifras reales del bloque de contexto financiero (gasto real por categoría del mes, comparativo histórico) — nunca inventes montos. Si no tienes ese contexto, no propongas números, explica que necesitas ver sus datos primero.
- "monto_sugerido" es el presupuesto MENSUAL en pesos para esa categoría → subcategoría (no total, no anual).
- Cada entrada de "cambios" necesita "categoria" (una de la lista de categorías válidas de arriba) y "subcategoria" (una de las subcategorías reales de esa categoría, igual que para gastos).
- Enfócate en las categorías de las que el usuario está hablando o donde el gasto real se aleja más de lo presupuestado — máximo 8 cambios por propuesta, no reescribas todo el catálogo de una vez si no viene al caso.
- "resumen" es una frase corta explicando la lógica (ej. "esto refleja lo que de verdad gastaste en Alimentación los últimos 3 meses, con un poco de margen").
- Si el usuario no está pidiendo un ajuste de presupuesto, "accion_presupuesto" debe ser null. Nunca actives "accion" y "accion_presupuesto" en el mismo turno.

CUÁNDO PROPONER ACTUALIZAR EL SALDO DE UNA CUENTA (campo "accion_saldo_cuenta"):
Si el usuario te dice cuánto tiene ahora en una cuenta (ej. "mi cuenta de BBVA ya tiene $12,500", "actualiza el saldo de mi efectivo a $3000"), propón "accion_saldo_cuenta" con tipo "actualizar_saldo_cuenta".
- "cuenta_nombre" tiene que ser EXACTAMENTE uno de estos nombres reales del usuario (o null si no reconoces a cuál se refiere):
${listaCuentas}
- "monto_nuevo" es el saldo total actual que menciona, no un incremento.
- Si el usuario no está dando un saldo actualizado de una cuenta real, "accion_saldo_cuenta" debe ser null.

CUÁNDO PROPONER UN INGRESO NUEVO O ACTUALIZADO (campo "accion_ingreso"):
Si el usuario menciona un ingreso que quiere registrar o actualizar (ej. "tengo un ingreso nuevo de sueldo por $30,000 mensuales", "mi sueldo ya no es $20,000, ahora es $22,000"), propón "accion_ingreso" con tipo "proponer_ingreso".
- Ingresos que el usuario ya tiene registrados (si el nombre coincide EXACTAMENTE con uno de estos, es una actualización — pon ese nombre en "ingreso_existente_nombre"; si es un ingreso nuevo, "ingreso_existente_nombre" debe ser null):
${listaIngresos}
- "nombre" es el nombre final a usar (el existente si es actualización, o uno corto y claro si es nuevo, ej. "Sueldo", "Freelance").
- "monto" es el monto mensual. "dia_del_mes" solo si lo menciona (1-31), si no null.
- Solo maneja ingresos MENSUALES por ahora — si mencionan algo semestral/anual, dile que por ahora eso se configura manual en la app, y deja "accion_ingreso" en null.
- Si no está describiendo un ingreso real, "accion_ingreso" debe ser null.

CUÁNDO PROPONER UN PAGO A UNA DEUDA (campo "accion_pago_deuda"):
Si el usuario dice que pagó/abonó dinero a una deuda (ej. "pagué $2000 a mi tarjeta BBVA", "le aboné $500 a mi crédito de auto"), propón "accion_pago_deuda" con tipo "proponer_pago_deuda". NUNCA propongas esto como "cambiar el saldo a X" — siempre es un PAGO que se resta del saldo actual, nunca inventes ni asumas el saldo resultante.
- "deuda_nombre" tiene que ser EXACTAMENTE uno de estos nombres reales (o null si no reconoces cuál):
${listaDeudas}
- "monto_pago" es cuánto pagó (siempre positivo).
- "cuenta_origen_nombre": si menciona de qué cuenta salió el dinero y coincide con una de estas, ponla aquí; si no lo menciona o no coincide, null:
${listaCuentas}
- Si el usuario no está describiendo un pago real a una deuda, "accion_pago_deuda" debe ser null.

CUÁNDO PROPONER UNA CUENTA NUEVA (campo "accion_cuenta_nueva"):
Si el usuario describe una cuenta real que quiere registrar (efectivo, débito, ahorro o inversión — ej. "abrí una cuenta de ahorro en Nu con $5000", "agrégame mi efectivo"), propón "accion_cuenta_nueva" con tipo "proponer_cuenta_nueva".
- "nombre": el que dio, o uno corto y razonable si no dio uno (ej. "Efectivo" para tipo Efectivo).
- "tipo_cuenta": EXACTAMENTE uno de "Efectivo" / "Débito" / "Ahorro" / "Inversión" / "Otra" — tu mejor estimación según lo que describe.
- "moneda": "MXN" si no dice nada distinto, o "USD"/"EUR"/"BTC" si lo menciona.
- "saldo_inicial": el saldo que menciona si dio uno, si no null (se puede capturar después en la app).
- "tasa_interes": solo si la menciona explícitamente, si no null.
- Si no está describiendo una cuenta real que quiere registrar, "accion_cuenta_nueva" debe ser null.

CUÁNDO PROPONER UNA DEUDA O TARJETA NUEVA (campo "accion_deuda_nueva"):
Si el usuario describe una deuda o tarjeta de crédito real que quiere registrar (ej. "métete mi tarjeta Santander, debo $8000, corte el 20 y pago el 5", "tengo un crédito hipotecario de $1,200,000"), propón "accion_deuda_nueva" con tipo "proponer_deuda_nueva".
- "nombre": el que dio (ej. "Tarjeta Santander"), o uno corto y claro si no dio uno.
- "tipo_deuda": EXACTAMENTE uno de "Tarjeta de crédito" / "Crédito hipotecario" / "Otro".
- "saldo": lo que debe hoy — obligatorio, si no lo dice usa tu mejor estimación de lo que mencionó o deja la propuesta más incompleta, nunca inventes un número sin ninguna pista.
- "moneda": "MXN" si no dice nada distinto.
- "tasa_interes", "pago_mensual", "dia_limite_pago" (1-31), "monto_proximo_pago": solo si los menciona, si no null.
- Si "tipo_deuda" es "Tarjeta de crédito" y menciona límite de crédito, anualidad, % de cashback, gasto mensual promedio o día de corte (1-31), captúralos en "limite_credito"/"anualidad"/"cashback_pct"/"gasto_mensual_promedio"/"dia_corte"; si no los menciona o el tipo no es tarjeta, todos esos van null.
- Si no está describiendo una deuda real que quiere registrar, "accion_deuda_nueva" debe ser null.

CUÁNDO PROPONER UN BIEN NUEVO (campo "accion_bien_nuevo"):
Si el usuario describe un bien real que quiere registrar (casa, coche, negocio, etc. — ej. "tengo una casa que vale como $2,000,000", "agrega mi camioneta, vale $350,000"), propón "accion_bien_nuevo" con tipo "proponer_bien_nuevo".
- "nombre": el que dio, o uno corto y claro (ej. "Casa", "Camioneta").
- "tipo_bien": EXACTAMENTE uno de "Inmueble" / "Vehículo" / "Negocio" / "Otro".
- "valor": el valor estimado que menciona — obligatorio.
- "moneda": "MXN" si no dice nada distinto.
- Si no está describiendo un bien real que quiere registrar, "accion_bien_nuevo" debe ser null.

CUÁNDO PROPONER UNA ACCIÓN NUEVA (campo "accion_accion_nueva"):
Si el usuario describe una compra de acciones/inversión en bolsa que quiere registrar (ej. "compré 10 acciones de Apple", "tengo 5 títulos de Femsa"), propón "accion_accion_nueva" con tipo "proponer_accion_nueva".
- "busqueda": el nombre de la empresa o símbolo/ticker tal cual lo mencionó (ej. "Apple", "AAPL", "Femsa") — el cliente hace la búsqueda real del símbolo antes de guardar, tú NO inventas ni asumes el ticker exacto, solo pasas lo que el usuario dijo.
- "cantidad": cuántas acciones/títulos, siempre positivo.
- Recuérdale, en tu "respuesta", que esto no cubre símbolos directos del BMV (solo EUA y ADRs mexicanos como AMX/FMX/CX) si el nombre suena a una empresa que probablemente cotiza solo ahí.
- Si no está describiendo una compra real de acciones que quiere registrar, "accion_accion_nueva" debe ser null.

REGLA GENERAL PARA TODAS LAS ACCIONES: como máximo UNA de "accion", "accion_presupuesto", "accion_saldo_cuenta", "accion_ingreso", "accion_pago_deuda", "accion_cuenta_nueva", "accion_deuda_nueva", "accion_bien_nuevo", "accion_accion_nueva" puede estar activa (no null) en un mismo turno — la que mejor corresponda a lo que describió el usuario. Las demás deben ser null.

Pantallas válidas a las que puedes mandar un link (usa exactamente una de estas claves en "destino", o null si ninguna aplica):
${DESTINO_KEYS.map((k) => `- "${k}" = ${DESTINOS[k]}`).join("\n")}

REGLAS para "destino":
- Si la pregunta es sobre CÓMO HACER algo o DÓNDE ENCONTRAR algo, y una de las pantallas de arriba es claramente el lugar correcto, pon esa clave en "destino" para que el usuario pueda ir directo con un tap.
- Si la pregunta es general, conceptual, o ninguna pantalla de la lista aplica claramente, destino debe ser null. No inventes una clave que no esté en la lista.
- Nunca menciones la clave interna (ej. "movimientos") en el texto de "respuesta" — el link ya muestra el nombre bonito de la pantalla, tú solo explica normalmente.

${idioma === "en" ? "IMPORTANT: respond ONLY in English, regardless of the language of these instructions." : "IMPORTANTE: responde SIEMPRE en español, sin importar el idioma de estas instrucciones."} Sé corto y directo, como un mentor de confianza. Si preguntan algo totalmente fuera de finanzas personales o del uso de la app, di amablemente que solo puedes ayudar con eso (en el mismo idioma).`;
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

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
    pregunta?: string;
    historial?: { rol: string; texto: string }[];
    snapshot?: unknown;
    medios_pago_disponibles?: MedioPagoDisponible[];
    cuentas_disponibles?: CuentaDisponible[];
    deudas_disponibles?: DeudaDisponible[];
    ingresos_existentes?: IngresoExistente[];
    audio_base64?: string;
    mime_type?: string;
    idioma?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }
  const preguntaTexto = typeof body.pregunta === "string" ? body.pregunta.trim() : "";
  const audioBase64 = typeof body.audio_base64 === "string" ? body.audio_base64 : "";
  if (!preguntaTexto && !audioBase64) {
    return jsonResponse({ error: "missing_pregunta" }, 400);
  }
  const historial = Array.isArray(body.historial) ? body.historial.slice(-6) : [];
  const snapshot = body.snapshot ?? null;
  const mediosPago = Array.isArray(body.medios_pago_disponibles) ? body.medios_pago_disponibles : [];
  const valoresValidosMedioPago = new Set(mediosPago.length ? mediosPago.map((m) => m.valor) : ["efectivo"]);
  const cuentas = Array.isArray(body.cuentas_disponibles) ? body.cuentas_disponibles : [];
  const deudas = Array.isArray(body.deudas_disponibles) ? body.deudas_disponibles : [];
  const ingresos = Array.isArray(body.ingresos_existentes) ? body.ingresos_existentes : [];
  const idioma = body.idioma === "en" ? "en" : "es";

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const openai = new OpenAI({ apiKey: openaiKey });

  try {
    let pregunta = preguntaTexto;
    let transcripcion: string | null = null;
    if (audioBase64) {
      const bytes = base64ToUint8Array(audioBase64);
      const archivo = await toFile(bytes, "nota.m4a", { type: body.mime_type || "audio/webm" });
      const transcripcionResp = await conTimeout(
        openai.audio.transcriptions.create({ file: archivo, model: MODEL_TRANSCRIPCION }),
        10000,
        "openai_transcripcion_timeout_10s"
      );
      transcripcion = transcripcionResp.text;
      pregunta = transcripcion;
      if (!pregunta || !pregunta.trim()) {
        return jsonResponse({ error: "audio_sin_texto" }, 400);
      }
    }

    const historialTexto = historial.length
      ? historial.map((h) =>
          `${h.rol === "asistente" ? "Freaky" : "Usuario"}: ${String(h.texto).slice(0, 2000)}`
        ).join("\n") + "\n\n"
      : "";
    const contextoFinanciero = snapshot
      ? `Contexto financiero actual del usuario (JSON generado por la app, no lo repitas tal cual, úsalo para fundamentar tu respuesta):\n${JSON.stringify(snapshot)}\n\n`
      : "";
    const inputTexto = `${contextoFinanciero}${historialTexto}Nueva pregunta del usuario: "${pregunta.slice(0, 2000)}"`;

    const response = await conTimeout(
      openai.responses.parse({
        model: MODEL,
        store: false,
        instructions: construirSystemPrompt(mediosPago, cuentas, deudas, ingresos, idioma),
        input: inputTexto,
        text: { format: zodTextFormat(RespuestaFreakySchema, "respuesta_freaky") },
      }),
      audioBase64 ? 25000 : 30000,
      "openai_respuesta_timeout"
    );

    const parsed = response.output_parsed;
    if (!parsed) throw new Error("empty_output_parsed");

    // Nunca confiar ciegamente en el medio_pago que devuelve el modelo: solo se
    // acepta si coincide exactamente con una de las opciones reales enviadas.
    let accion = parsed.accion;
    if (accion) {
      const medioValidado = accion.medio_pago_sugerido && valoresValidosMedioPago.has(accion.medio_pago_sugerido)
        ? accion.medio_pago_sugerido
        : null;
      // El modelo no siempre respeta "YYYY-MM-DD o null" al pie de la letra (se
      // vio en producción con procesar-solicitud-gasto: devolvió "/null" y
      // "hoy" como texto literal) -- se normaliza aquí mismo, en el origen,
      // para que el cliente nunca reciba algo que rompa un insert a `date`.
      accion = { ...accion, medio_pago_sugerido: medioValidado, fecha_sugerida: fechaValidaOAhora(accion.fecha_sugerida) };
    }

    // Igual de estricto con el presupuesto: cada categoria/subcategoria tiene
    // que existir tal cual en el catálogo real, o esa línea se descarta.
    let accionPresupuesto = parsed.accion_presupuesto;
    if (accionPresupuesto) {
      const cambiosValidos = accionPresupuesto.cambios.filter(
        (c) => CATALOGO_GASTOS[c.categoria]?.includes(c.subcategoria)
      );
      accionPresupuesto = cambiosValidos.length > 0 ? { ...accionPresupuesto, cambios: cambiosValidos } : null;
    }

    // Mismo criterio para las 3 acciones nuevas: el nombre que devuelve el
    // modelo tiene que coincidir exactamente con algo real que se le mandó,
    // si no, se anula esa acción completa (nunca se guarda a ciegas).
    let accionSaldoCuenta = parsed.accion_saldo_cuenta;
    if (accionSaldoCuenta) {
      const cuentaValida = cuentas.some((c) => c.nombre === accionSaldoCuenta!.cuenta_nombre);
      accionSaldoCuenta = cuentaValida ? accionSaldoCuenta : null;
    }

    let accionIngreso = parsed.accion_ingreso;
    if (accionIngreso && accionIngreso.ingreso_existente_nombre) {
      const ingresoValido = ingresos.some((i) => i.nombre === accionIngreso!.ingreso_existente_nombre);
      if (!ingresoValido) accionIngreso = { ...accionIngreso, ingreso_existente_nombre: null };
    }

    let accionPagoDeuda = parsed.accion_pago_deuda;
    if (accionPagoDeuda) {
      const deudaValida = deudas.some((d) => d.nombre === accionPagoDeuda!.deuda_nombre);
      if (!deudaValida) {
        accionPagoDeuda = null;
      } else if (accionPagoDeuda.cuenta_origen_nombre) {
        const cuentaValida = cuentas.some((c) => c.nombre === accionPagoDeuda!.cuenta_origen_nombre);
        if (!cuentaValida) accionPagoDeuda = { ...accionPagoDeuda, cuenta_origen_nombre: null };
      }
    }

    // Las 4 acciones de "registrar algo nuevo" no tienen nombre real que
    // validar contra nada existente (son cosas que todavía no existen) — el
    // único filtro es que "acción" (bolsa) siempre pasa por la búsqueda real
    // de símbolo en el cliente antes de guardar, nunca se guarda con el
    // símbolo que puso el modelo a ciegas.
    const accionCuentaNueva = parsed.accion_cuenta_nueva;
    const accionDeudaNueva = parsed.accion_deuda_nueva;
    const accionBienNuevo = parsed.accion_bien_nuevo;
    const accionAccionNueva = parsed.accion_accion_nueva;

    return jsonResponse({
      respuesta: parsed.respuesta,
      sugerencias_respuesta: parsed.sugerencias_respuesta,
      destino: parsed.destino,
      accion,
      accion_presupuesto: accionPresupuesto,
      accion_saldo_cuenta: accionSaldoCuenta,
      accion_ingreso: accionIngreso,
      accion_pago_deuda: accionPagoDeuda,
      accion_cuenta_nueva: accionCuentaNueva,
      accion_deuda_nueva: accionDeudaNueva,
      accion_bien_nuevo: accionBienNuevo,
      accion_accion_nueva: accionAccionNueva,
      transcripcion,
    });
  } catch (e) {
    console.error("Error respondiendo pregunta sobre la app:", e);
    // TODO: quitar "detail" una vez diagnosticado — es temporal, para poder
    // ver el error real sin acceso a los logs del servidor.
    const detail = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "processing_failed", detail }, 500);
  }
});
