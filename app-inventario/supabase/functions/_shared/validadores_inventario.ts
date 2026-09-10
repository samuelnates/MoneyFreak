// Motor de validación de cargas mensuales. Cada regla es una función pura e
// independiente: (fila, contexto) -> Hallazgo[]. Agregar una regla nueva NO
// requiere tocar las demás ni el resto de inventario-cargar — solo hay que
// sumarla al arreglo REGLAS_VALIDACION al final de este archivo. Este es el
// punto de extensión pensado para ir afinando "qué es atípico" con el uso
// real de la herramienta, sin rediseñar nada.

export interface FilaMetrica {
  tienda_id: string;
  tienda_codigo: string;
  marca_id: string;
  marca_codigo: string;
  uds_vendidas_actual: number | null;
  uds_vendidas_anterior: number | null;
  vta_dev_actual: number | null;
  costo_ventas_actual: number | null;
  inventario_actual: number | null;
  inventario_anterior: number | null;
  costo_inv_actual: number | null;
  costo_inv_anterior: number | null;
  moi_cto_actual: number | null;
  anio_vs_anio: number | null;
  desc_prom_vta_actual: number | null;
  margen_prom_vta_actual: number | null;
  [campo: string]: unknown;
}

export type Severidad = "info" | "advertencia" | "critica";

export interface Hallazgo {
  regla: string;
  severidad: Severidad;
  campo?: string;
  valor_actual?: number | null;
  valor_referencia?: number | null;
  mensaje: string;
}

export interface ContextoValidacion {
  // Última fila conocida de la MISMA tienda en un periodo anterior (o null si es su primera carga).
  historicoPorTienda: Map<string, FilaMetrica | null>;
  // Todas las filas de la misma carga que pertenecen a la misma marca (incluida la propia), para comparar contra pares.
  filasPorMarca: Map<string, FilaMetrica[]>;
}

// ---- Umbrales, ajustables sin tocar la lógica de cada regla ----
const UMBRAL_VARIACION_MENSUAL = 0.6; // ±60% vs el mes anterior de la misma tienda
const UMBRAL_ANIO_VS_ANIO_BAJO = -0.6; // -60%
const UMBRAL_ANIO_VS_ANIO_ALTO = 3.0; // +300%
const MOI_MAXIMO_RAZONABLE = 36; // meses de inventario
const Z_SCORE_UMBRAL = 2.5;
const MINIMO_PARES_PARA_ZSCORE = 4; // con menos tiendas hermanas, la desviación estándar no es confiable

function media(valores: number[]): number {
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}
function desviacionEstandar(valores: number[], m: number): number {
  const varianza = valores.reduce((acc, v) => acc + (v - m) ** 2, 0) / valores.length;
  return Math.sqrt(varianza);
}

type Regla = (fila: FilaMetrica, ctx: ContextoValidacion) => Hallazgo[];

const reglaValoresNegativos: Regla = (fila) => {
  const hallazgos: Hallazgo[] = [];
  const campos: [string, number | null][] = [
    ["uds_vendidas_actual", fila.uds_vendidas_actual],
    ["inventario_actual", fila.inventario_actual],
    ["costo_ventas_actual", fila.costo_ventas_actual],
    ["costo_inv_actual", fila.costo_inv_actual],
  ];
  for (const [campo, valor] of campos) {
    if (typeof valor === "number" && valor < 0) {
      hallazgos.push({
        regla: "valores_negativos",
        severidad: "critica",
        campo,
        valor_actual: valor,
        mensaje: `${fila.tienda_codigo}: "${campo}" viene negativo (${valor}). Revisa el archivo original, seguramente es un error de captura.`,
      });
    }
  }
  return hallazgos;
};

const reglaMoiFueraDeRango: Regla = (fila) => {
  if (typeof fila.moi_cto_actual !== "number") return [];
  if (fila.moi_cto_actual > MOI_MAXIMO_RAZONABLE) {
    return [{
      regla: "moi_fuera_de_rango",
      severidad: "advertencia",
      campo: "moi_cto_actual",
      valor_actual: fila.moi_cto_actual,
      valor_referencia: MOI_MAXIMO_RAZONABLE,
      mensaje: `${fila.tienda_codigo}: ${fila.moi_cto_actual.toFixed(1)} meses de inventario a costo — muy por encima de lo razonable (>${MOI_MAXIMO_RAZONABLE}). Puede indicar inventario estancado o un error en costo/ventas.`,
    }];
  }
  if (fila.moi_cto_actual < 0) {
    return [{
      regla: "moi_fuera_de_rango",
      severidad: "advertencia",
      campo: "moi_cto_actual",
      valor_actual: fila.moi_cto_actual,
      mensaje: `${fila.tienda_codigo}: meses de inventario negativo (${fila.moi_cto_actual.toFixed(1)}), revisa el cálculo de origen.`,
    }];
  }
  return [];
};

function cambioPorcentual(actual: number, anterior: number): number | null {
  if (anterior === 0) return actual === 0 ? 0 : null; // división entre cero: no hay base de comparación válida
  return (actual - anterior) / Math.abs(anterior);
}

const reglaVariacionMensual: Regla = (fila, ctx) => {
  const anterior = ctx.historicoPorTienda.get(fila.tienda_id);
  if (!anterior) return []; // primera vez que se ve esta tienda, no hay con qué comparar
  const hallazgos: Hallazgo[] = [];
  const campos: ("uds_vendidas_actual" | "inventario_actual" | "costo_inv_actual")[] = [
    "uds_vendidas_actual",
    "inventario_actual",
    "costo_inv_actual",
  ];
  for (const campo of campos) {
    const valorActual = fila[campo];
    const valorAnterior = anterior[campo];
    if (typeof valorActual !== "number" || typeof valorAnterior !== "number") continue;
    const cambio = cambioPorcentual(valorActual, valorAnterior);
    if (cambio === null) continue;
    if (Math.abs(cambio) > UMBRAL_VARIACION_MENSUAL) {
      hallazgos.push({
        regla: "variacion_vs_mes_anterior",
        severidad: "advertencia",
        campo,
        valor_actual: valorActual,
        valor_referencia: valorAnterior,
        mensaje: `${fila.tienda_codigo}: "${campo}" cambió ${(cambio * 100).toFixed(0)}% vs el mes anterior (${valorAnterior} → ${valorActual}). Confirma que no sea un error de carga.`,
      });
    }
  }
  return hallazgos;
};

const reglaAtipicoVsPares: Regla = (fila, ctx) => {
  const pares = (ctx.filasPorMarca.get(fila.marca_id) || []).filter((f) => f.tienda_id !== fila.tienda_id);
  if (pares.length < MINIMO_PARES_PARA_ZSCORE) return [];
  const hallazgos: Hallazgo[] = [];
  const campos: ("uds_vendidas_actual" | "margen_prom_vta_actual" | "desc_prom_vta_actual")[] = [
    "uds_vendidas_actual",
    "margen_prom_vta_actual",
    "desc_prom_vta_actual",
  ];
  for (const campo of campos) {
    const valor = fila[campo];
    if (typeof valor !== "number") continue;
    const valoresPares = pares.map((p) => p[campo]).filter((v): v is number => typeof v === "number");
    if (valoresPares.length < MINIMO_PARES_PARA_ZSCORE) continue;
    const m = media(valoresPares);
    const sd = desviacionEstandar(valoresPares, m);
    if (sd === 0) continue;
    const z = (valor - m) / sd;
    if (Math.abs(z) > Z_SCORE_UMBRAL) {
      hallazgos.push({
        regla: "atipico_vs_tiendas_similares",
        severidad: "advertencia",
        campo,
        valor_actual: valor,
        valor_referencia: Number(m.toFixed(2)),
        mensaje: `${fila.tienda_codigo}: "${campo}" = ${valor} se aleja mucho del resto de tiendas de ${fila.marca_codigo} este mes (promedio ${m.toFixed(2)}, z=${z.toFixed(1)}).`,
      });
    }
  }
  return hallazgos;
};

const reglaAnioVsAnioExtremo: Regla = (fila) => {
  if (typeof fila.anio_vs_anio !== "number") return [];
  if (fila.anio_vs_anio < UMBRAL_ANIO_VS_ANIO_BAJO || fila.anio_vs_anio > UMBRAL_ANIO_VS_ANIO_ALTO) {
    return [{
      regla: "anio_vs_anio_extremo",
      severidad: "info",
      campo: "anio_vs_anio",
      valor_actual: fila.anio_vs_anio,
      mensaje: `${fila.tienda_codigo}: variación año contra año de ${(fila.anio_vs_anio * 100).toFixed(0)}% — vale la pena confirmar que sea real (apertura/cierre de tienda, promoción puntual, etc.) y no un error.`,
    }];
  }
  return [];
};

const reglaMargenFueraDeEscala: Regla = (fila) => {
  const hallazgos: Hallazgo[] = [];
  const campos: ("margen_prom_vta_actual" | "desc_prom_vta_actual")[] = ["margen_prom_vta_actual", "desc_prom_vta_actual"];
  for (const campo of campos) {
    const valor = fila[campo];
    if (typeof valor === "number" && (valor > 1.5 || valor < -1.5)) {
      hallazgos.push({
        regla: "porcentaje_fuera_de_escala",
        severidad: "advertencia",
        campo,
        valor_actual: valor,
        mensaje: `${fila.tienda_codigo}: "${campo}" = ${valor} no parece estar expresado como fracción (0.0–1.0). Revisa si se cargó como porcentaje entero por error.`,
      });
    }
  }
  return hallazgos;
};

export const REGLAS_VALIDACION: Regla[] = [
  reglaValoresNegativos,
  reglaMoiFueraDeRango,
  reglaVariacionMensual,
  reglaAtipicoVsPares,
  reglaAnioVsAnioExtremo,
  reglaMargenFueraDeEscala,
];

export function validarCarga(filas: FilaMetrica[], ctx: ContextoValidacion): (Hallazgo & { tienda_id: string; marca_id: string })[] {
  const resultado: (Hallazgo & { tienda_id: string; marca_id: string })[] = [];
  for (const fila of filas) {
    for (const regla of REGLAS_VALIDACION) {
      for (const hallazgo of regla(fila, ctx)) {
        resultado.push({ ...hallazgo, tienda_id: fila.tienda_id, marca_id: fila.marca_id });
      }
    }
  }
  return resultado;
}
