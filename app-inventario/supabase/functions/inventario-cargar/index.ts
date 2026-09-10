// Edge Function: inventario-cargar
//
// Solo editores. Recibe el JSON ya normalizado por js/parser.js (el navegador
// lee el .xlsx con SheetJS; aquí no se parsea Excel, solo se valida y se
// guarda). Dos modos:
//   - dry_run: true  -> corre las reglas de validación y regresa las
//     alertas SIN escribir nada en la base. Es lo que usa la pantalla de
//     "Carga" para mostrar la vista previa antes de confirmar.
//   - dry_run: false (default) -> además de validar, guarda todo (catálogo
//     de marcas/tiendas, métricas, CEDIS/tránsito, histórico e alertas).
//
// Campos numéricos reconocidos de inv_metricas_tienda -- cualquier otro
// campo que mande el parser se guarda tal cual en la columna `extra`
// (jsonb), así que agregar una métrica nueva al reporte no rompe la carga
// aunque todavía no tenga su propia columna.
const CAMPOS_METRICA = [
  "uds_vendidas_actual", "uds_vendidas_anterior",
  "vta_dev_actual", "vta_dev_anterior",
  "costo_ventas_actual", "costo_ventas_anterior",
  "inventario_actual", "inventario_anterior",
  "inv_dev_actual", "inv_dev_anterior",
  "costo_inv_actual", "costo_inv_anterior",
  "moi_uds_actual", "moi_dev_actual", "moi_cto_actual",
  "moi_uds_anterior", "moi_dev_anterior", "moi_cto_anterior",
  "anio_vs_anio",
  "desc_prom_vta_actual", "desc_prom_vta_anterior",
  "margen_prom_vta_actual", "margen_prom_vta_anterior",
  "desc_prom_inv_actual", "desc_prom_inv_anterior",
  "margen_prom_inv_actual", "margen_prom_inv_anterior",
  "pp_vta_actual", "pp_vta_anterior",
] as const;

import { createClient } from "npm:@supabase/supabase-js@2";
import { CORS_HEADERS, ErrorSesion, jsonResponse, requireSesion } from "../_shared/auth.ts";
import { type ContextoValidacion, type FilaMetrica, validarCarga } from "../_shared/validadores_inventario.ts";

interface TiendaPayload {
  canal: string;
  codigo: string;
  nombre?: string;
  [campo: string]: unknown;
}
interface CedisTransitoPayload {
  tipo: "cedis" | "transito";
  anio: number;
  inventario?: number | null;
  dev_ex_inv?: number | null;
  costo_total_inv?: number | null;
}
interface MarcaPayload {
  codigo: string;
  nombre: string;
  tiendas: TiendaPayload[];
  cedis_transito?: CedisTransitoPayload[];
  totales_reportados?: Record<string, number>;
}
interface HistoricoMarcaPayload {
  marca_codigo: string;
  anio: number;
  mes: number;
  costo_inventario: number | null;
}
interface CargaPayload {
  formato?: string;
  archivo_nombre?: string;
  periodo: { anio: number; mes: number; etiqueta: string };
  marcas: MarcaPayload[];
  historico_marca_mensual?: HistoricoMarcaPayload[];
  resumen_bruto?: Record<string, unknown>;
  dry_run?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const jwtSecret = Deno.env.get("INVENTARIO_JWT_SECRET");
  if (!jwtSecret) return jsonResponse({ error: "server_misconfigured" }, 500);

  let sesion;
  try {
    sesion = await requireSesion(req, jwtSecret, ["editor"]);
  } catch (e) {
    if (e instanceof ErrorSesion) return jsonResponse({ error: e.message }, e.status);
    throw e;
  }

  let payload: CargaPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }

  if (!payload.periodo?.anio || !payload.periodo?.mes) {
    return jsonResponse({ error: "missing_periodo" }, 400);
  }
  if (!Array.isArray(payload.marcas) || payload.marcas.length === 0) {
    return jsonResponse({ error: "sin_marcas_en_el_archivo" }, 400);
  }
  const dryRun = payload.dry_run === true;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // ---- 1) Periodo ----
  const fecha = `${payload.periodo.anio}-${String(payload.periodo.mes).padStart(2, "0")}-01`;
  const { data: periodo, error: errPeriodo } = await admin
    .from("inv_periodos")
    .upsert(
      { anio: payload.periodo.anio, mes: payload.periodo.mes, etiqueta: payload.periodo.etiqueta, fecha },
      { onConflict: "anio,mes" },
    )
    .select()
    .single();
  if (errPeriodo || !periodo) {
    console.error(errPeriodo);
    return jsonResponse({ error: "periodo_upsert_failed" }, 500);
  }

  // ---- 2) Marcas ----
  const marcasParaUpsert = payload.marcas.map((m, i) => ({ codigo: m.codigo, nombre: m.nombre, orden: i }));
  const { data: marcasGuardadas, error: errMarcas } = await admin
    .from("inv_marcas")
    .upsert(marcasParaUpsert, { onConflict: "codigo", ignoreDuplicates: false })
    .select("id, codigo");
  if (errMarcas || !marcasGuardadas) {
    console.error(errMarcas);
    return jsonResponse({ error: "marcas_upsert_failed" }, 500);
  }
  const idMarcaPorCodigo = new Map(marcasGuardadas.map((m) => [m.codigo, m.id]));

  // ---- 3) Tiendas (de todas las marcas, en un solo upsert) ----
  const tiendasParaUpsert: { marca_id: string; canal: string; codigo: string; nombre: string }[] = [];
  for (const marca of payload.marcas) {
    const marcaId = idMarcaPorCodigo.get(marca.codigo);
    if (!marcaId) continue;
    for (const t of marca.tiendas) {
      tiendasParaUpsert.push({ marca_id: marcaId, canal: t.canal, codigo: t.codigo, nombre: t.nombre || t.codigo });
    }
  }
  let idTiendaPorClave = new Map<string, string>();
  if (tiendasParaUpsert.length > 0) {
    const { data: tiendasGuardadas, error: errTiendas } = await admin
      .from("inv_tiendas")
      .upsert(tiendasParaUpsert, { onConflict: "marca_id,canal,codigo", ignoreDuplicates: false })
      .select("id, marca_id, canal, codigo");
    if (errTiendas || !tiendasGuardadas) {
      console.error(errTiendas);
      return jsonResponse({ error: "tiendas_upsert_failed" }, 500);
    }
    idTiendaPorClave = new Map(tiendasGuardadas.map((t) => [`${t.marca_id}|${t.canal}|${t.codigo}`, t.id]));
  }

  // ---- 4) Armar filas normalizadas de métricas (para validar y, si aplica, guardar) ----
  const filasMetrica: (FilaMetrica & Record<string, unknown>)[] = [];
  for (const marca of payload.marcas) {
    const marcaId = idMarcaPorCodigo.get(marca.codigo);
    if (!marcaId) continue;
    for (const t of marca.tiendas) {
      const tiendaId = idTiendaPorClave.get(`${marcaId}|${t.canal}|${t.codigo}`);
      if (!tiendaId) continue;
      const fila: Record<string, unknown> = {
        tienda_id: tiendaId,
        tienda_codigo: t.codigo,
        marca_id: marcaId,
        marca_codigo: marca.codigo,
        periodo_id: periodo.id,
      };
      const extra: Record<string, unknown> = {};
      for (const [campo, valor] of Object.entries(t)) {
        if (campo === "canal" || campo === "codigo" || campo === "nombre") continue;
        if ((CAMPOS_METRICA as readonly string[]).includes(campo)) {
          fila[campo] = typeof valor === "number" ? valor : null;
        } else {
          extra[campo] = valor;
        }
      }
      for (const campo of CAMPOS_METRICA) if (!(campo in fila)) fila[campo] = null;
      fila.extra = extra;
      filasMetrica.push(fila as FilaMetrica & Record<string, unknown>);
    }
  }

  // ---- 5) Contexto de validación: última fila previa por tienda + pares por marca ----
  const tiendaIds = filasMetrica.map((f) => f.tienda_id);
  const historicoPorTienda = new Map<string, FilaMetrica | null>();
  if (tiendaIds.length > 0) {
    const { data: historicoCrudo, error: errHistorico } = await admin
      .from("inv_metricas_tienda")
      .select("*, inv_periodos(fecha)")
      .in("tienda_id", tiendaIds)
      .neq("periodo_id", periodo.id);
    if (errHistorico) {
      console.error(errHistorico);
    } else {
      const fechaActual = fecha;
      const masReciente = new Map<string, { fecha: string; fila: FilaMetrica }>();
      for (const row of historicoCrudo || []) {
        const f = (row as { inv_periodos?: { fecha: string } }).inv_periodos?.fecha;
        if (!f || f >= fechaActual) continue;
        const previo = masReciente.get(row.tienda_id);
        if (!previo || f > previo.fecha) masReciente.set(row.tienda_id, { fecha: f, fila: row as unknown as FilaMetrica });
      }
      for (const tId of tiendaIds) historicoPorTienda.set(tId, masReciente.get(tId)?.fila ?? null);
    }
  }
  const filasPorMarca = new Map<string, FilaMetrica[]>();
  for (const fila of filasMetrica) {
    const arr = filasPorMarca.get(fila.marca_id) || [];
    arr.push(fila);
    filasPorMarca.set(fila.marca_id, arr);
  }
  const ctx: ContextoValidacion = { historicoPorTienda, filasPorMarca };
  const hallazgos = validarCarga(filasMetrica, ctx);

  if (dryRun) {
    return jsonResponse({
      dry_run: true,
      total_filas: filasMetrica.length,
      total_alertas: hallazgos.length,
      alertas: hallazgos,
    });
  }

  // ---- 6) Crear la carga y guardar todo ----
  const estadoInicial = hallazgos.length > 0 ? "con_alertas" : "aprobada";

  const { data: carga, error: errCarga } = await admin
    .from("inv_cargas")
    .insert({
      periodo_id: periodo.id,
      archivo_nombre: payload.archivo_nombre ?? null,
      cargado_por: sesion.nombre,
      formato: payload.formato ?? "cole-collection-v1",
      estado: estadoInicial,
      total_filas: filasMetrica.length,
      total_alertas: hallazgos.length,
      resumen_bruto: { resumen: payload.resumen_bruto ?? null, totales_por_marca: payload.marcas.map((m) => ({ codigo: m.codigo, totales: m.totales_reportados ?? null })) },
    })
    .select()
    .single();
  if (errCarga || !carga) {
    console.error(errCarga);
    return jsonResponse({ error: "carga_insert_failed" }, 500);
  }

  // Marca como revertidas las cargas previas del mismo periodo (auditoría: sus filas de
  // inv_metricas_tienda quedaron reemplazadas por el upsert de abajo).
  await admin
    .from("inv_cargas")
    .update({ estado: "revertida" })
    .eq("periodo_id", periodo.id)
    .neq("id", carga.id)
    .neq("estado", "revertida");

  if (filasMetrica.length > 0) {
    // tienda_codigo/marca_codigo son campos sintéticos que solo usan los
    // validadores para redactar los mensajes de alerta — no existen como
    // columnas en inv_metricas_tienda, hay que quitarlos antes de guardar.
    const filasParaGuardar = filasMetrica.map((f) => {
      const copia = { ...f, carga_id: carga.id } as Record<string, unknown>;
      delete copia.tienda_codigo;
      delete copia.marca_codigo;
      return copia;
    });
    const { error: errMetricas } = await admin
      .from("inv_metricas_tienda")
      .upsert(filasParaGuardar, { onConflict: "periodo_id,tienda_id" });
    if (errMetricas) {
      console.error(errMetricas);
      return jsonResponse({ error: "metricas_upsert_failed" }, 500);
    }
  }

  // ---- 7) CEDIS / tránsito ----
  const cedisTransitoParaGuardar: Record<string, unknown>[] = [];
  for (const marca of payload.marcas) {
    const marcaId = idMarcaPorCodigo.get(marca.codigo);
    if (!marcaId || !marca.cedis_transito) continue;
    for (const ct of marca.cedis_transito) {
      cedisTransitoParaGuardar.push({
        carga_id: carga.id,
        periodo_id: periodo.id,
        marca_id: marcaId,
        tipo: ct.tipo,
        anio: ct.anio,
        inventario: ct.inventario ?? null,
        dev_ex_inv: ct.dev_ex_inv ?? null,
        costo_total_inv: ct.costo_total_inv ?? null,
      });
    }
  }
  if (cedisTransitoParaGuardar.length > 0) {
    const { error: errCedis } = await admin
      .from("inv_cedis_transito")
      .upsert(cedisTransitoParaGuardar, { onConflict: "periodo_id,marca_id,tipo,anio" });
    if (errCedis) console.error(errCedis);
  }

  // ---- 8) Backfill histórico a nivel marca (pestañas tipo graficas_julio) ----
  if (payload.historico_marca_mensual?.length) {
    const paraGuardar = payload.historico_marca_mensual
      .map((h) => {
        const marcaId = idMarcaPorCodigo.get(h.marca_codigo);
        if (!marcaId) return null;
        return {
          marca_id: marcaId,
          anio: h.anio,
          mes: h.mes,
          costo_inventario: h.costo_inventario,
          fuente: "backfill",
          carga_id: carga.id,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (paraGuardar.length > 0) {
      const { error: errHist } = await admin
        .from("inv_historico_marca_mensual")
        .upsert(paraGuardar, { onConflict: "marca_id,anio,mes,fuente" });
      if (errHist) console.error(errHist);
    }
  }

  // ---- 9) Alertas ----
  if (hallazgos.length > 0) {
    const alertasParaGuardar = hallazgos.map((h) => ({
      carga_id: carga.id,
      periodo_id: periodo.id,
      tienda_id: h.tienda_id,
      marca_id: h.marca_id,
      regla: h.regla,
      severidad: h.severidad,
      campo: h.campo ?? null,
      valor_actual: h.valor_actual ?? null,
      valor_referencia: h.valor_referencia ?? null,
      mensaje: h.mensaje,
    }));
    const { error: errAlertas } = await admin.from("inv_alertas").insert(alertasParaGuardar);
    if (errAlertas) console.error(errAlertas);
  }

  await admin.from("inv_auditoria").insert({
    usuario: sesion.nombre,
    rol: sesion.rol,
    accion: "carga",
    detalle: { carga_id: carga.id, periodo: payload.periodo, archivo_nombre: payload.archivo_nombre, total_filas: filasMetrica.length, total_alertas: hallazgos.length },
  });

  return jsonResponse({
    dry_run: false,
    carga_id: carga.id,
    estado: estadoInicial,
    total_filas: filasMetrica.length,
    total_alertas: hallazgos.length,
    alertas: hallazgos,
  });
});
