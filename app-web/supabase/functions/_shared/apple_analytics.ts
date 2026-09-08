// Lógica compartida para hablar con la API de Analítica de App Store Connect
// (descargas, impresiones, conversión). Compartida entre panel-admin-apple-analytics
// (lectura desde el panel, con opción de refresco manual) y sync-analitica-apple
// (refresco automático por cron, parte 195) para no tener dos copias del
// mismo pipeline desincronizándose.
//
// LA API DE ANALÍTICA DE APPLE ES ASÍNCRONA, no un solo request-respuesta:
// 1) Se pide (o se reutiliza si ya existe) una "solicitud de reporte
//    continua" (accessType: ONGOING) para la app -- CREARLA por primera vez
//    exige que la API Key tenga rol Admin (confirmado en la parte 193: con
//    la key de rol "Ventas e Informes"/Access to Reports dio 403
//    FORBIDDEN_ERROR justo en este paso -- ese rol solo sirve para
//    DESCARGAR reportes que ya existen, no para crear la solicitud inicial).
// 2) Esa solicitud trae varios "reportes" (categorías: descubrimiento y
//    interacción, instalaciones y eliminaciones, uso, etc.).
// 3) Cada reporte tiene "instancias" (una por día/semana ya generado).
// 4) Cada instancia trae "segmentos": URLs firmadas (sin necesitar el JWT)
//    a archivos CSV/TSV comprimidos en gzip con los números reales.
//
// Los pasos 3 y 4 se procesan de forma genérica (parte 194): sin hardcodear
// los nombres exactos de columna que usa Apple (podrían cambiar), se agrupa
// cada fila por su columna de fecha (si existe una llamada "Date") y se
// suman las columnas numéricas -- así el panel puede mostrar lo que Apple
// mande de verdad en vez de asumir un esquema fijo que nunca se pudo probar
// en vivo desde el sandbox de desarrollo (bloquea la salida de red hacia
// api.appstoreconnect.apple.com).

const INSTANCIAS_POR_REPORTE = 5;
const SEGMENTOS_MAXIMOS_TOTAL = 25;
// Exportado (parte 200) para que _shared/apple_reviews.ts reutilice la
// misma firma de JWT y el mismo id de app en vez de duplicarlos.
export const APPLE_APP_ID = "6805201423";

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

export async function firmarJWTAppStoreConnect(): Promise<string> {
  const keyId = Deno.env.get("APPLE_ASC_KEY_ID");
  const issuerId = Deno.env.get("APPLE_ASC_ISSUER_ID");
  const privateKeyPem = Deno.env.get("APPLE_ASC_PRIVATE_KEY");
  if (!keyId || !issuerId || !privateKeyPem) {
    throw new Error("Faltan las variables APPLE_ASC_KEY_ID / APPLE_ASC_ISSUER_ID / APPLE_ASC_PRIVATE_KEY");
  }
  const ahora = Math.floor(Date.now() / 1000);
  const header = base64UrlDesdeTexto(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const claims = base64UrlDesdeTexto(JSON.stringify({
    iss: issuerId,
    iat: ahora,
    exp: ahora + 60 * 15,
    aud: "appstoreconnect-v1",
  }));
  const llave = await importarLlavePrivadaApple(privateKeyPem);
  const firma = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    llave,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64UrlDesdeBytes(new Uint8Array(firma))}`;
}

export async function llamarAppleAPI(jwt: string, path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const resp = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data };
}

async function descargarYDescomprimirSegmento(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error(`No se pudo descargar el segmento (status ${resp.status})`);
  const stream = resp.body.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function parsearFilasTSV(texto: string): Record<string, string>[] {
  const lineas = texto.split("\n").filter((l) => l.trim().length > 0);
  if (lineas.length < 2) return [];
  const encabezados = lineas[0].split("\t").map((h) => h.trim());
  return lineas.slice(1).map((linea) => {
    const valores = linea.split("\t");
    const fila: Record<string, string> = {};
    encabezados.forEach((h, i) => { fila[h] = (valores[i] ?? "").trim(); });
    return fila;
  });
}

// Además de agrupar por fecha, detecta UNA columna "dimensión" (categórica:
// ni fecha ni numérica) para poder desglosar el total del periodo por ahí
// -- parte 197, pedido explícito: "desglosar por dimensión, no solo por
// fecha" para saber DE DÓNDE vienen las descargas (territorio, dispositivo,
// tipo de página), no solo cuántas. Se prioriza territorio/país, luego
// dispositivo, luego tipo de página, y si no hay ninguna de esas se toma la
// primera columna categórica que tenga una cardinalidad razonable (2-50
// valores distintos en la muestra) -- una columna con 1 solo valor no dice
// nada, y una con cientos (como un identificador) tampoco sirve para un
// desglose legible.
function elegirColumnaDimension(encabezados: string[], columnaFecha: string | null, columnasNumericas: string[], filas: Record<string, string>[]): string | null {
  const candidatas = encabezados.filter((h) => h !== columnaFecha && !columnasNumericas.includes(h));
  if (candidatas.length === 0) return null;
  const prioridad = [/territory|country/i, /device/i, /page.?type|content.?type|download.?type/i];
  for (const regex of prioridad) {
    const encontrada = candidatas.find((h) => regex.test(h));
    if (encontrada) return encontrada;
  }
  for (const h of candidatas) {
    const valores = new Set(filas.slice(0, 200).map((f) => f[h]).filter((v) => v !== ""));
    if (valores.size >= 2 && valores.size <= 50) return h;
  }
  return null;
}

function agruparPorFecha(filas: Record<string, string>[]): { columnaFecha: string | null; columnasNumericas: string[]; porFecha: Record<string, Record<string, number>>; columnaDimension: string | null; porDimension: Record<string, Record<string, number>> } {
  if (filas.length === 0) return { columnaFecha: null, columnasNumericas: [], porFecha: {}, columnaDimension: null, porDimension: {} };
  const encabezados = Object.keys(filas[0]);
  const columnaFecha = encabezados.find((h) => h.toLowerCase() === "date") ?? null;
  const columnasNumericas = encabezados.filter((h) => {
    if (h === columnaFecha) return false;
    // Bug real reportado por el usuario (parte 222): "App Apple Identifier"
    // -- el ID numérico de la app, siempre el mismo valor repetido en cada
    // fila -- pasaba el check de "todo son números" y se colaba como
    // columna numérica. Al ser la primera columna numérica del TSV, el
    // panel la tomaba como LA métrica del reporte y sumaba el ID miles de
    // veces (una vez por fila/territorio/fecha), dando cifras absurdas
    // (cientos de miles de millones). Mismo problema con "App Version"
    // ("1.2", "1.1"...) -- un número de versión también pasa el check de
    // "son números" pero sumar versiones no significa nada. Ninguna columna
    // de identificador o versión es una cantidad que tenga sentido sumar
    // aunque sus valores sean numéricos -- se excluyen por nombre (columnas
    // reales de Apple para esto: "App Apple Identifier", "App Version",
    // "Platform Version", nunca una métrica de verdad como "Counts" o
    // "Sessions").
    if (/identifier|version/i.test(h)) return false;
    const valores = filas.slice(0, 50).map((f) => f[h]).filter((v) => v !== "");
    if (valores.length === 0) return false;
    return valores.every((v) => !isNaN(Number(v)));
  });
  const columnaDimension = elegirColumnaDimension(encabezados, columnaFecha, columnasNumericas, filas);
  const porFecha: Record<string, Record<string, number>> = {};
  const porDimension: Record<string, Record<string, number>> = {};
  for (const fila of filas) {
    const clave = columnaFecha ? (fila[columnaFecha] || "sin_fecha") : "todo";
    if (!porFecha[clave]) porFecha[clave] = {};
    const claveDim = columnaDimension ? (fila[columnaDimension] || "sin_dato") : null;
    if (claveDim && !porDimension[claveDim]) porDimension[claveDim] = {};
    for (const col of columnasNumericas) {
      const valor = Number(fila[col] || 0);
      const valorLimpio = isNaN(valor) ? 0 : valor;
      porFecha[clave][col] = (porFecha[clave][col] || 0) + valorLimpio;
      if (claveDim) porDimension[claveDim][col] = (porDimension[claveDim][col] || 0) + valorLimpio;
    }
  }
  return { columnaFecha, columnasNumericas, porFecha, columnaDimension, porDimension };
}

export type ReporteAppleConDatos = {
  id: string; nombre: string | null; categoria: string | null;
  columnaFecha: string | null; columnasNumericas: string[];
  porFecha: Record<string, Record<string, number>>;
  columnaDimension: string | null;
  porDimension: Record<string, Record<string, number>>;
  erroresParciales: string[];
};

export type ResultadoAnaliticaApple = {
  solicitudId: string;
  solicitudReciénCreada: boolean;
  avisoPrimeraVez: string | null;
  segmentosDescargados: number;
  reportes: ReporteAppleConDatos[];
};

// Corre el pipeline completo (pasos 1-4) y regresa los reportes con sus
// datos ya agrupados por fecha. Tarda varios segundos (varias llamadas a
// Apple en cadena) -- por eso el panel normalmente NO llama esto en vivo,
// sino que lee el resultado ya guardado por sync-analitica-apple.
export async function obtenerAnaliticaApple(): Promise<ResultadoAnaliticaApple> {
  const jwtApple = await firmarJWTAppStoreConnect();

  const listaExistente = await llamarAppleAPI(
    jwtApple,
    `/v1/apps/${APPLE_APP_ID}/analyticsReportRequests?filter[accessType]=ONGOING`,
  );
  if (!listaExistente.ok) {
    throw new Error(`apple_api_error en listar_solicitud: ${JSON.stringify(listaExistente).slice(0, 500)}`);
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
      throw new Error(`apple_api_error en crear_solicitud: ${JSON.stringify(creadaJson).slice(0, 500)}`);
    }
    solicitudId = (creadaJson as { data: { id: string } }).data.id;
    solicitudReciénCreada = true;
  }

  const reportes = await llamarAppleAPI(jwtApple, `/v1/analyticsReportRequests/${solicitudId}/reports?limit=50`);
  if (!reportes.ok) {
    throw new Error(`apple_api_error en listar_reportes: ${JSON.stringify(reportes).slice(0, 500)}`);
  }
  const listaReportes = ((reportes.data as { data?: { id: string; attributes?: { name?: string; category?: string } }[] })?.data || [])
    .map((r) => ({ id: r.id, nombre: r.attributes?.name ?? null, categoria: r.attributes?.category ?? null }));

  if (listaReportes.length === 0) {
    return {
      solicitudId,
      solicitudReciénCreada,
      avisoPrimeraVez: solicitudReciénCreada
        ? "Se acaba de crear la solicitud de analítica para esta app. Apple tarda 24-48 horas en generar los primeros datos -- vuelve a intentarlo mañana."
        : "Todavía no hay ningún reporte disponible para esta app -- si la solicitud es reciente, espera a que Apple termine de generarlos.",
      segmentosDescargados: 0,
      reportes: [],
    };
  }

  let segmentosDescargados = 0;
  const reportesConDatos: ReporteAppleConDatos[] = [];

  for (const rep of listaReportes) {
    if (segmentosDescargados >= SEGMENTOS_MAXIMOS_TOTAL) break;
    const erroresParciales: string[] = [];

    const instanciasResp = await llamarAppleAPI(jwtApple, `/v1/analyticsReports/${rep.id}/instances?limit=30`);
    if (!instanciasResp.ok) {
      erroresParciales.push(`No se pudieron listar instancias: status ${instanciasResp.status}`);
      reportesConDatos.push({ ...rep, columnaFecha: null, columnasNumericas: [], porFecha: {}, columnaDimension: null, porDimension: {}, erroresParciales });
      continue;
    }
    const instancias = ((instanciasResp.data as { data?: { id: string; attributes?: { processingDate?: string; granularity?: string } }[] })?.data || [])
      .filter((i) => i.attributes?.granularity === "DAILY" || !i.attributes?.granularity)
      .sort((a, b) => (b.attributes?.processingDate || "").localeCompare(a.attributes?.processingDate || ""))
      .slice(0, INSTANCIAS_POR_REPORTE);

    const porFechaAcumulado: Record<string, Record<string, number>> = {};
    const porDimensionAcumulado: Record<string, Record<string, number>> = {};
    let columnaFechaDetectada: string | null = null;
    let columnasNumericasDetectadas: string[] = [];
    let columnaDimensionDetectada: string | null = null;

    for (const instancia of instancias) {
      if (segmentosDescargados >= SEGMENTOS_MAXIMOS_TOTAL) break;
      const segmentosResp = await llamarAppleAPI(jwtApple, `/v1/analyticsReportInstances/${instancia.id}/segments`);
      if (!segmentosResp.ok) {
        erroresParciales.push(`Instancia ${instancia.id}: no se pudieron listar segmentos (status ${segmentosResp.status})`);
        continue;
      }
      const segmentos = (segmentosResp.data as { data?: { attributes?: { url?: string } }[] })?.data || [];
      for (const seg of segmentos) {
        if (segmentosDescargados >= SEGMENTOS_MAXIMOS_TOTAL) break;
        const url = seg.attributes?.url;
        if (!url) continue;
        try {
          const texto = await descargarYDescomprimirSegmento(url);
          segmentosDescargados++;
          const filas = parsearFilasTSV(texto);
          const { columnaFecha, columnasNumericas, porFecha, columnaDimension, porDimension } = agruparPorFecha(filas);
          if (columnaFecha) columnaFechaDetectada = columnaFecha;
          if (columnaDimension) columnaDimensionDetectada = columnaDimension;
          for (const col of columnasNumericas) {
            if (!columnasNumericasDetectadas.includes(col)) columnasNumericasDetectadas.push(col);
          }
          for (const [fecha, metricas] of Object.entries(porFecha)) {
            if (!porFechaAcumulado[fecha]) porFechaAcumulado[fecha] = {};
            for (const [col, valor] of Object.entries(metricas)) {
              porFechaAcumulado[fecha][col] = (porFechaAcumulado[fecha][col] || 0) + valor;
            }
          }
          for (const [dim, metricas] of Object.entries(porDimension)) {
            if (!porDimensionAcumulado[dim]) porDimensionAcumulado[dim] = {};
            for (const [col, valor] of Object.entries(metricas)) {
              porDimensionAcumulado[dim][col] = (porDimensionAcumulado[dim][col] || 0) + valor;
            }
          }
        } catch (e) {
          erroresParciales.push(`Segmento: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    reportesConDatos.push({
      ...rep,
      columnaFecha: columnaFechaDetectada,
      columnasNumericas: columnasNumericasDetectadas,
      porFecha: porFechaAcumulado,
      columnaDimension: columnaDimensionDetectada,
      porDimension: porDimensionAcumulado,
      erroresParciales,
    });
  }

  return {
    solicitudId,
    solicitudReciénCreada,
    avisoPrimeraVez: solicitudReciénCreada
      ? "Se acaba de crear la solicitud de analítica para esta app. Apple tarda 24-48 horas en generar los primeros datos -- vuelve a intentarlo mañana."
      : null,
    segmentosDescargados,
    reportes: reportesConDatos,
  };
}
