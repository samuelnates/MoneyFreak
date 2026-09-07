// Edge Function: revisar-alertas-presupuesto
//
// Fase 2 del plan de notificaciones (parte 168). Corre una vez al día por
// cron (pg_cron + pg_net, ver la migración/el job asociado) y evalúa, para
// cada usuario que activó "avisarme si voy a exceder mi presupuesto", si su
// gasto de este mes va camino a rebasar lo presupuestado -- si es así 2 días
// seguidos, manda un push real vía Firebase Cloud Messaging.
//
// LA PARTE IMPORTANTE (por qué no es solo "gastado ÷ día × días del mes"):
// el usuario reportó que casi todos sus pagos fuertes caen al principio del
// mes -- con una proyección lineal simple, cualquier mes se vería "camino a
// rebasar" desde el día 2, aunque termine gastando lo normal. En vez de
// proyectar con el ritmo de HOY, se compara el ritmo de este mes contra el
// ritmo TÍPICO del usuario en meses anteriores a la misma altura del mes
// (mismo día): si el usuario siempre gasta el 40% de su mes en la primera
// semana porque ahí caen renta/suscripciones, ese 40% temprano ya está
// "horneado" en el promedio histórico y no dispara nada -- solo se marca
// como alerta si el gasto de HOY está genuinamente por encima de ese propio
// patrón, no solo por encima de un promedio diario ingenuo.

import { createClient } from "npm:@supabase/supabase-js@2";
import { mandarPush, obtenerAccessTokenFCM } from "../_shared/fcm.ts";

const CATALOGO_GASTOS: Record<string, string[]> = {
  "Vivienda": ["Renta o hipoteca", "Mantenimiento", "Servicios (luz, agua, gas)", "Muebles y enseres", "Empleada del hogar"],
  "Transporte": ["Gasolina", "Transporte público", "Uber / taxi", "Mantenimiento del auto", "Estacionamiento", "Crédito de auto"],
  "Alimentación": ["Súper", "Restaurantes", "Café y antojos"],
  "Salud": ["Consultas médicas", "Medicinas", "Seguro médico", "Dental"],
  "Entretenimiento": ["Streaming", "Cine y eventos", "Salidas", "Hobbies", "Vacaciones"],
  "Educación": ["Colegiaturas", "Cursos", "Libros y material"],
  "Cuidado personal": ["Ropa", "Belleza y estética", "Gimnasio"],
  "Mascotas": ["Comida", "Veterinario", "Accesorios"],
  "Servicios y suscripciones": ["Teléfono e internet", "Apps y software", "Otras suscripciones"],
  "Ahorro e inversión": ["Aportación a inversión", "Fondo de emergencia"],
  "Otros": ["Regalos", "Imprevistos", "Varios"],
};
const MESES_POR_PERIODICIDAD: Record<string, number> = { mensual: 1, semestral: 6, anual: 12 };
const UMBRAL_PROYECCION = 1.0; // proyección > 100% del presupuesto = candidato a alerta
const DIAS_SEGUIDOS_PARA_AVISAR = 2; // colchón: no avisar por una sola compra grande aislada
const DIA_MINIMO_DEL_MES = 7; // muy poca info los primeros días, mejor no evaluar todavía
const MESES_HISTORIA_A_COMPARAR = 3;
const MESES_HISTORIA_MINIMOS = 2; // si hay menos de 2 meses con datos, no hay patrón confiable que comparar

type Gasto = { fecha: string; categoria: string; subcategoria: string | null; monto: number; moneda: string };
type Presupuesto = { subcategoria: string | null; monto: number; moneda: string; periodicidad: string | null };

function fechaMexico(offsetDias = 0): string {
  const ahora = new Date(Date.now() + offsetDias * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

function diasEnMes(anio: number, mesIndex0: number): number {
  return new Date(anio, mesIndex0 + 1, 0).getDate();
}

async function obtenerTasasCambio(): Promise<Record<string, number | null>> {
  const tasas: Record<string, number | null> = { MXN: 1, USD: null, EUR: null, BTC: null };
  try {
    const [usdResp, eurResp, btcResp] = await Promise.all([
      fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN").then((r) => r.json()),
      fetch("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=MXN").then((r) => r.json()),
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=mxn").then((r) => r.json()),
    ]);
    tasas.USD = usdResp?.rates?.MXN ?? null;
    tasas.EUR = eurResp?.rates?.MXN ?? null;
    tasas.BTC = btcResp?.bitcoin?.mxn ?? null;
  } catch (e) {
    console.warn("No se pudieron cargar tipos de cambio, se asume 1:1 para monedas no-MXN", e);
  }
  return tasas;
}

function convertirAMXN(monto: number, moneda: string | null, tasas: Record<string, number | null>): number {
  if (!moneda || moneda === "MXN") return monto;
  const tasa = tasas[moneda];
  return tasa ? monto * tasa : monto; // sin cotización disponible: mejor no perder el monto que descartarlo
}

// ===== Proyección de gasto del mes con el ritmo histórico del propio usuario =====
type ResultadoProyeccion =
  | { estado: "ok"; proyeccion: number; totalPresupuestado: number }
  | { estado: "sin_presupuesto" }
  | { estado: "sin_historia" };

async function calcularProyeccion(
  admin: ReturnType<typeof createClient>,
  userId: string,
  anio: number,
  mesIndex0: number,
  diaActual: number,
  tasas: Record<string, number | null>
): Promise<ResultadoProyeccion> {
  const primerDiaMes = `${anio}-${String(mesIndex0 + 1).padStart(2, "0")}-01`;
  const hoyISO = fechaMexico();

  const [{ data: presupuestos }, { data: gastosEsteMes }] = await Promise.all([
    admin.from("presupuestos").select("subcategoria, monto, moneda, periodicidad").eq("user_id", userId),
    admin.from("gastos").select("fecha, categoria, subcategoria, monto, moneda").eq("user_id", userId).gte("fecha", primerDiaMes).lte("fecha", hoyISO),
  ]);

  let totalPresupuestado = 0;
  (presupuestos as Presupuesto[] || []).forEach((p) => {
    if (!p.subcategoria) return;
    const meses = MESES_POR_PERIODICIDAD[p.periodicidad || "mensual"] || 1;
    totalPresupuestado += convertirAMXN(Number(p.monto), p.moneda, tasas) / meses;
  });
  if (totalPresupuestado <= 0) return { estado: "sin_presupuesto" };

  const gastoAcumuladoHoy = (gastosEsteMes as Gasto[] || []).reduce((acc, g) => acc + convertirAMXN(Number(g.monto), g.moneda, tasas), 0);

  // Últimos MESES_HISTORIA_A_COMPARAR meses CERRADOS (no el actual).
  let sumaAcumuladoHistorico = 0;
  let sumaTotalHistorico = 0;
  let mesesConDatos = 0;
  for (let i = 1; i <= MESES_HISTORIA_A_COMPARAR; i++) {
    const fechaRef = new Date(anio, mesIndex0 - i, 1);
    const anioRef = fechaRef.getFullYear();
    const mesRef = fechaRef.getMonth();
    const diasDelMesRef = diasEnMes(anioRef, mesRef);
    const diaComparable = Math.min(diaActual, diasDelMesRef);
    const primerDiaRef = `${anioRef}-${String(mesRef + 1).padStart(2, "0")}-01`;
    const ultimoDiaRef = `${anioRef}-${String(mesRef + 1).padStart(2, "0")}-${String(diasDelMesRef).padStart(2, "0")}`;
    const diaComparableISO = `${anioRef}-${String(mesRef + 1).padStart(2, "0")}-${String(diaComparable).padStart(2, "0")}`;

    const { data: gastosMesRef } = await admin
      .from("gastos")
      .select("fecha, monto, moneda")
      .eq("user_id", userId)
      .gte("fecha", primerDiaRef)
      .lte("fecha", ultimoDiaRef);
    const filas = (gastosMesRef as { fecha: string; monto: number; moneda: string }[]) || [];
    if (filas.length === 0) continue; // mes sin ningún dato -- no cuenta como "patrón", se ignora

    mesesConDatos++;
    sumaTotalHistorico += filas.reduce((acc, g) => acc + convertirAMXN(Number(g.monto), g.moneda, tasas), 0);
    sumaAcumuladoHistorico += filas
      .filter((g) => g.fecha <= diaComparableISO)
      .reduce((acc, g) => acc + convertirAMXN(Number(g.monto), g.moneda, tasas), 0);
  }

  if (mesesConDatos < MESES_HISTORIA_MINIMOS) return { estado: "sin_historia" };

  const promedioAcumuladoHistorico = sumaAcumuladoHistorico / mesesConDatos;
  const promedioTotalHistorico = sumaTotalHistorico / mesesConDatos;

  let proyeccion: number;
  if (promedioAcumuladoHistorico > 0) {
    // Núcleo del arreglo: el ritmo de HOY se mide relativo a su propio ritmo
    // típico a esta misma altura del mes, no contra un promedio diario plano.
    const ritmoRelativo = gastoAcumuladoHoy / promedioAcumuladoHistorico;
    proyeccion = promedioTotalHistorico * ritmoRelativo;
  } else {
    // Caso raro (los meses de referencia no tenían nada gastado a esta
    // altura, ej. siempre gastan todo al final): cae a la proyección lineal
    // simple como respaldo, mejor que dividir entre cero.
    const diasDelMesActual = diasEnMes(anio, mesIndex0);
    proyeccion = (gastoAcumuladoHoy / diaActual) * diasDelMesActual;
  }

  return { estado: "ok", proyeccion, totalPresupuestado };
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

  const hoyISO = fechaMexico();
  const [anio, mesHumano, diaActual] = hoyISO.split("-").map(Number);
  const mesIndex0 = mesHumano - 1;
  const mesActualClave = `${anio}-${String(mesHumano).padStart(2, "0")}`;

  if (diaActual < DIA_MINIMO_DEL_MES) {
    return new Response(JSON.stringify({ ok: true, saltado: "muy_temprano_en_el_mes" }));
  }

  const { data: perfiles, error: errorPerfiles } = await admin
    .from("perfil_financiero")
    .select("user_id, idioma_preferido")
    .eq("notif_alerta_presupuesto", true);
  if (errorPerfiles) {
    console.error("Error leyendo perfiles con la preferencia activa:", errorPerfiles);
    return new Response(JSON.stringify({ error: "error_leyendo_perfiles" }), { status: 500 });
  }
  if (!perfiles || perfiles.length === 0) {
    return new Response(JSON.stringify({ ok: true, usuarios_evaluados: 0 }));
  }

  const tasas = await obtenerTasasCambio();
  let accessTokenFCM: string | null = null;
  const resumen = { evaluados: 0, notificados: 0, sin_historia: 0, sin_presupuesto: 0, errores: 0 };

  for (const perfil of perfiles) {
    try {
      const userId = perfil.user_id as string;
      const { data: tokens } = await admin.from("push_tokens").select("token").eq("user_id", userId);
      if (!tokens || tokens.length === 0) continue; // activó la preferencia pero nunca se registró el dispositivo

      const resultado = await calcularProyeccion(admin, userId, anio, mesIndex0, diaActual, tasas);
      resumen.evaluados++;
      if (resultado.estado === "sin_presupuesto") {
        resumen.sin_presupuesto++;
        continue;
      }
      if (resultado.estado === "sin_historia") {
        resumen.sin_historia++;
        continue;
      }

      const { data: estadoActual } = await admin.from("alertas_presupuesto_estado").select("*").eq("user_id", userId).maybeSingle();
      let diasSeguidos = estadoActual && estadoActual.mes === mesActualClave ? estadoActual.dias_seguidos_excedido : 0;
      let notificado = estadoActual && estadoActual.mes === mesActualClave ? estadoActual.notificado : false;

      const excedido = resultado.proyeccion > resultado.totalPresupuestado * UMBRAL_PROYECCION;
      diasSeguidos = excedido ? diasSeguidos + 1 : 0;

      if (excedido && diasSeguidos >= DIAS_SEGUIDOS_PARA_AVISAR && !notificado) {
        if (!accessTokenFCM) accessTokenFCM = await obtenerAccessTokenFCM(serviceAccount);
        const pct = Math.round((resultado.proyeccion / resultado.totalPresupuestado) * 100);
        const enIngles = perfil.idioma_preferido === "en";
        const titulo = enIngles ? "You're on track to exceed your budget" : "Vas camino a exceder tu presupuesto";
        const cuerpo = enIngles
          ? `At this month's spending pace, you're projected to hit ${pct}% of your total budget.`
          : `Con tu ritmo de gasto de este mes, vas proyectado a ${pct}% de tu presupuesto total.`;
        let algunoOk = false;
        for (const { token } of tokens) {
          const ok = await mandarPush(accessTokenFCM, serviceAccount.project_id, token, titulo, cuerpo, "presupuesto_alerta");
          if (ok) algunoOk = true;
        }
        if (algunoOk) {
          notificado = true;
          resumen.notificados++;
        }
      }

      await admin.from("alertas_presupuesto_estado").upsert({
        user_id: userId,
        mes: mesActualClave,
        dias_seguidos_excedido: diasSeguidos,
        notificado,
        actualizado_en: new Date().toISOString(),
      });
    } catch (e) {
      resumen.errores++;
      console.error(`Error evaluando alerta de presupuesto para un usuario:`, e);
    }
  }

  return new Response(JSON.stringify({ ok: true, ...resumen }));
});
