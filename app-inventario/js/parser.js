// Adaptador(es) de formato de reporte: convierte un workbook de SheetJS en
// el JSON normalizado que espera la Edge Function inventario-cargar. Está
// pensado como un registro de formatos (FORMATOS_REPORTE) para que, si el
// día de mañana llega un reporte con otro layout (otra empresa, otra
// plantilla), se pueda sumar un adaptador nuevo sin tocar los existentes
// ni el resto de la app: basta con agregar una entrada al registro con su
// propio `detectar()` y `parsear()`.

const MESES_ES = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};
const NOMBRE_MES = Object.fromEntries(Object.entries(MESES_ES).map(([k, v]) => [v, k[0] + k.slice(1).toLowerCase()]));

const RANGO_DIACRITICOS = /[\u0300-\u036f]/g;
function normalizar(texto) {
  return String(texto ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(RANGO_DIACRITICOS, "")
    .replace(/\s+/g, " ")
    .trim();
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsearPeriodoLabel(texto) {
  const norm = normalizar(texto);
  const m = norm.match(/([A-Z]+)\s+(\d{4})/);
  if (!m) return null;
  const mes = MESES_ES[m[1]];
  if (!mes) return null;
  return { anio: Number(m[2]), mes, etiqueta: texto.trim() };
}

// Offsets de columna (0-indexado, A=0) dentro de cada bloque "Tiendas..." ->
// nombre de campo en inv_metricas_tienda. Fijo porque el layout de columnas
// de Cole Collection es idéntico en cada bloque/pestaña (verificado contra
// varios meses) — si un mes trae una columna de más/menos, decímalo por el
// nombre en detectarFormato() y ajusta aquí, no en la Edge Function.
const OFFSETS_METRICA = {
  1: "uds_vendidas_actual", 2: "uds_vendidas_anterior",
  3: "vta_dev_actual", 4: "vta_dev_anterior",
  5: "costo_ventas_actual", 6: "costo_ventas_anterior",
  7: "inventario_actual", 8: "inventario_anterior",
  9: "inv_dev_actual", 10: "inv_dev_anterior",
  11: "costo_inv_actual", 12: "costo_inv_anterior",
  13: "moi_uds_actual", 14: "moi_dev_actual", 15: "moi_cto_actual",
  17: "moi_uds_anterior", 18: "moi_dev_anterior", 19: "moi_cto_anterior",
  21: "anio_vs_anio",
  22: "desc_prom_vta_actual", 23: "desc_prom_vta_anterior",
  24: "margen_prom_vta_actual", 25: "margen_prom_vta_anterior",
  26: "desc_prom_inv_actual", 27: "desc_prom_inv_anterior",
  28: "margen_prom_inv_actual", 29: "margen_prom_inv_anterior",
  30: "pp_vta_actual", 31: "pp_vta_anterior",
};

function esFilaEncabezadoBloque(fila) {
  return typeof fila?.[1] === "string" && /^uds vendidas/i.test(fila[1].trim());
}
function esFilaTotal(fila) {
  const a = String(fila?.[0] ?? "").trim();
  return /^total\b/i.test(a);
}

// Parsea una pestaña de marca ("Rep TR", "Rep JS", ...): detecta cada
// bloque de tiendas (principal, Palacio de Hierro, Ecommerce PH, etc. —
// varían por marca) de forma genérica buscando la fila que dice
// "Uds Vendidas 26" en la columna B, sin asumir cuántos bloques hay ni en
// qué fila empiezan.
function parsearPestanaMarca(sheet, codigoMarca) {
  const filas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  if (filas.length < 3) return null;

  const anioActual = numOrNull(filas[0]?.[1]);
  const anioAnterior = numOrNull(filas[0]?.[7]);
  const nombreMarca = String(filas[1]?.[0] ?? codigoMarca).trim();
  const periodo = parsearPeriodoLabel(filas[2]?.[0]);

  const cedis_transito = [];
  if (filas[1]) {
    cedis_transito.push(
      { tipo: "cedis", anio: anioActual, inventario: numOrNull(filas[1][2]), dev_ex_inv: numOrNull(filas[1][3]), costo_total_inv: numOrNull(filas[1][4]) },
      { tipo: "cedis", anio: anioAnterior, inventario: numOrNull(filas[1][8]), dev_ex_inv: numOrNull(filas[1][9]), costo_total_inv: numOrNull(filas[1][10]) },
    );
  }
  if (filas[2]) {
    cedis_transito.push(
      { tipo: "transito", anio: anioActual, inventario: numOrNull(filas[2][2]), dev_ex_inv: numOrNull(filas[2][3]), costo_total_inv: numOrNull(filas[2][4]) },
      { tipo: "transito", anio: anioAnterior, inventario: numOrNull(filas[2][8]), dev_ex_inv: numOrNull(filas[2][9]), costo_total_inv: numOrNull(filas[2][10]) },
    );
  }

  const tiendas = [];
  let canalActual = null;

  for (let r = 5; r < filas.length; r++) {
    const fila = filas[r];
    if (!fila) continue;
    if (esFilaEncabezadoBloque(fila)) {
      canalActual = normalizar(fila[0]).toLowerCase();
      continue;
    }
    if (canalActual === null) continue; // todavía no llegamos al primer bloque
    if (esFilaTotal(fila)) {
      canalActual = null; // cierra el bloque; la siguiente fila con datos pertenece a otro bloque (o no hay más)
      continue;
    }
    const codigo = fila[0] != null ? String(fila[0]).trim() : "";
    if (!codigo) continue; // fila en blanco entre bloques
    // Filas como "TR PV" / "TTL TR" (subtotal de marca) no tienen bloque
    // abierto en este punto porque ya se cerró con la fila "Total general"
    // anterior — nunca deberían caer aquí, pero por si acaso se ignoran
    // explícitamente en vez de guardarse como si fueran una tienda real.
    if (/^total general/i.test(codigo)) continue;

    const tienda = { canal: canalActual, codigo, nombre: codigo };
    for (const [offset, campo] of Object.entries(OFFSETS_METRICA)) {
      tienda[campo] = numOrNull(fila[Number(offset)]);
    }
    tiendas.push(tienda);
  }

  // Subtotal reportado por la propia hoja ("TR PV" / "TTL TR"), útil para
  // que la pantalla de carga muestre "la suma de tiendas parseadas cuadra
  // con lo que dice el archivo" antes de confirmar.
  let totalReportado = null;
  for (const fila of filas) {
    const codigo = normalizar(fila?.[0]);
    if (codigo === `${normalizar(codigoMarca)} PV` || codigo === `TTL ${normalizar(codigoMarca)}`) {
      totalReportado = numOrNull(fila[1]);
    }
  }

  return {
    codigo: codigoMarca,
    nombre: nombreMarca,
    periodo,
    cedis_transito,
    tiendas,
    totales_reportados: { total_hoja: totalReportado, suma_parseada: tiendas.reduce((a, t) => a + (t.uds_vendidas_actual || 0), 0) },
  };
}

// Pestañas históricas tipo "graficas_julio": grupos repetidos de 5 columnas
// (MARCA, MES, AÑO1, AÑO2, AÑO3) con costo de inventario a cierre de mes.
// Sirve para poblar de golpe varios años de historia a nivel marca desde la
// primera carga, sin tener que subir un archivo por cada mes pasado.
function parsearPestanaHistorica(sheet, marcasConocidas) {
  const filas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  const registros = [];
  const advertencias = [];
  let filaEncabezado = -1;
  for (let r = 0; r < Math.min(filas.length, 6); r++) {
    if (filas[r]?.some((c) => normalizar(c) === "MARCA")) {
      filaEncabezado = r;
      break;
    }
  }
  if (filaEncabezado === -1) return { registros, advertencias };

  const encabezado = filas[filaEncabezado];
  const grupos = [];
  for (let c = 0; c < encabezado.length; c++) {
    if (normalizar(encabezado[c]) === "MARCA" && normalizar(encabezado[c + 1]) === "MES") {
      grupos.push({ colMarca: c, colMes: c + 1, anios: [c + 2, c + 3, c + 4].map((ac) => numOrNull(encabezado[ac])) });
    }
  }

  const resolverMarca = (nombreHist) => {
    const norm = normalizar(nombreHist);
    return marcasConocidas.find((m) => {
      const nm = normalizar(m.nombre);
      return nm === norm || nm.includes(norm) || norm.includes(nm);
    });
  };

  for (let r = filaEncabezado + 1; r < filas.length; r++) {
    const fila = filas[r];
    if (!fila) continue;
    for (const grupo of grupos) {
      const nombreMarcaHist = fila[grupo.colMarca];
      const mesTexto = fila[grupo.colMes];
      if (!nombreMarcaHist || !mesTexto) continue;
      const mes = MESES_ES[normalizar(mesTexto)];
      if (!mes) continue;
      const marca = resolverMarca(nombreMarcaHist);
      if (!marca) {
        advertencias.push(`No se pudo emparejar la marca "${nombreMarcaHist}" del histórico con ninguna marca del archivo — se omitió.`);
        continue;
      }
      grupo.anios.forEach((anio, i) => {
        if (!anio) return;
        const valor = numOrNull(fila[grupo.colMarca + 2 + i]);
        if (valor === null) return;
        registros.push({ marca_codigo: marca.codigo, anio, mes, costo_inventario: valor });
      });
    }
  }
  return { registros, advertencias };
}

const FORMATOS_REPORTE = {
  "cole-collection-v1": {
    detectar(workbook) {
      return workbook.SheetNames.some((n) => /^rep\s+/i.test(n));
    },
    parsear(workbook, nombreArchivo) {
      const advertencias = [];
      const hojasMarca = workbook.SheetNames.filter((n) => /^rep\s+/i.test(n));
      const marcas = [];
      let periodo = null;

      for (const nombreHoja of hojasMarca) {
        const codigoMarca = nombreHoja.replace(/^rep\s+/i, "").trim().toUpperCase();
        const resultado = parsearPestanaMarca(workbook.Sheets[nombreHoja], codigoMarca);
        if (!resultado) {
          advertencias.push(`La pestaña "${nombreHoja}" no tiene el formato esperado y se omitió.`);
          continue;
        }
        if (resultado.periodo) periodo = periodo || resultado.periodo;
        if (resultado.tiendas.length === 0) {
          advertencias.push(`La pestaña "${nombreHoja}" no arrojó ninguna tienda — revísala, puede que cambió el layout.`);
        }
        const { periodo: _p, ...marca } = resultado;
        marcas.push(marca);

        const { total_hoja, suma_parseada } = marca.totales_reportados;
        if (total_hoja != null && Math.abs(total_hoja - suma_parseada) > 0.5) {
          advertencias.push(`"${marca.nombre}": la suma de unidades vendidas parseadas (${suma_parseada}) no coincide con el total reportado en el archivo (${total_hoja}). Revisa la pestaña ${nombreHoja}.`);
        }
      }

      if (!periodo) {
        advertencias.push("No se pudo leer el mes/año del reporte (celda A3 de la primera pestaña de marca) — revísalo antes de confirmar la carga.");
      }

      let historico_marca_mensual = [];
      const hojaHistorica = workbook.SheetNames.find((n) => /^graficas/i.test(n) && n.toLowerCase() !== "graficas");
      if (hojaHistorica) {
        const { registros, advertencias: advHist } = parsearPestanaHistorica(workbook.Sheets[hojaHistorica], marcas);
        historico_marca_mensual = registros;
        advertencias.push(...advHist);
      }

      let resumen_bruto = null;
      if (workbook.SheetNames.includes("Resumen")) {
        resumen_bruto = XLSX.utils.sheet_to_json(workbook.Sheets["Resumen"], { header: 1, raw: true, defval: null });
      }

      return {
        payload: {
          formato: "cole-collection-v1",
          archivo_nombre: nombreArchivo,
          periodo: periodo || { anio: null, mes: null, etiqueta: null },
          marcas,
          historico_marca_mensual,
          resumen_bruto,
        },
        advertencias,
      };
    },
  },
};

function detectarFormato(workbook) {
  for (const [id, adaptador] of Object.entries(FORMATOS_REPORTE)) {
    if (adaptador.detectar(workbook)) return id;
  }
  return null;
}

// Punto de entrada usado por la pantalla de Carga. Lanza un Error con
// mensaje legible si no reconoce el archivo.
function parsearWorkbook(workbook, nombreArchivo) {
  const formatoId = detectarFormato(workbook);
  if (!formatoId) {
    throw new Error("No se reconoce el formato de este archivo (se esperaban pestañas 'Rep <marca>'). Si es un layout nuevo, hay que sumar un adaptador en js/parser.js.");
  }
  return { formatoId, ...FORMATOS_REPORTE[formatoId].parsear(workbook, nombreArchivo) };
}

window.InventarioParser = { detectarFormato, parsearWorkbook, FORMATOS_REPORTE, MESES_ES, NOMBRE_MES, normalizar };
