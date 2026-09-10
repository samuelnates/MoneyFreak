// Controlador principal de la SPA (sin framework, a propósito: mismo
// enfoque que app-web/, sin paso de build). Todas las funciones que
// terminan en "Vista" pintan una sección completa a partir del estado.

const estado = {
  sesion: null,
  catalogo: { marcas: [], tiendas: [], periodos: [] },
  filtro: { marcas: [], periodoDesde: null, periodoHasta: null },
  cargaPendiente: null, // { payload, formatoId, advertencias, previsualizacion }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function mostrarSoloSeccion(id) {
  $$(".seccion").forEach((el) => (el.hidden = el.id !== id));
}

function mensajeError(texto) {
  const el = $("#mensaje-global");
  el.textContent = texto;
  el.hidden = false;
  el.className = "mensaje mensaje-error";
  setTimeout(() => (el.hidden = true), 6000);
}
function mensajeOk(texto) {
  const el = $("#mensaje-global");
  el.textContent = texto;
  el.hidden = false;
  el.className = "mensaje mensaje-ok";
  setTimeout(() => (el.hidden = true), 6000);
}

// ---------------------------------------------------------------- Sesión --

async function init() {
  estado.sesion = window.InventarioAPI.leerSesion();
  $("#form-login").addEventListener("submit", manejarLogin);
  $("#btn-cerrar-sesion").addEventListener("click", () => {
    window.InventarioAPI.logout();
    estado.sesion = null;
    mostrarSoloSeccion("vista-login");
  });
  $$("#nav-tabs button").forEach((btn) => btn.addEventListener("click", () => cambiarTab(btn.dataset.tab)));

  if (estado.sesion) {
    await arrancarApp();
  } else {
    mostrarSoloSeccion("vista-login");
  }
}

async function manejarLogin(e) {
  e.preventDefault();
  const palabraClave = $("#input-palabra-clave").value.trim();
  if (!palabraClave) return;
  const btn = $("#form-login button[type=submit]");
  btn.disabled = true;
  try {
    estado.sesion = await window.InventarioAPI.login(palabraClave);
    $("#input-palabra-clave").value = "";
    await arrancarApp();
  } catch (err) {
    mensajeError("Palabra clave incorrecta o vencida.");
  } finally {
    btn.disabled = false;
  }
}

async function arrancarApp() {
  $("#usuario-nombre").textContent = estado.sesion.nombre;
  $("#usuario-rol").textContent = estado.sesion.rol === "editor" ? "Editor" : "Viewer";
  const esEditor = estado.sesion.rol === "editor";
  $$(".solo-editor").forEach((el) => (el.hidden = !esEditor));
  mostrarSoloSeccion("vista-app");

  try {
    estado.catalogo = await window.InventarioAPI.catalogo();
  } catch (err) {
    mensajeError("No se pudo cargar el catálogo de marcas/tiendas.");
    return;
  }
  renderFiltrosDashboard();
  cambiarTab("dashboard");
}

function cambiarTab(tab) {
  $$("#nav-tabs button").forEach((b) => b.classList.toggle("activo", b.dataset.tab === tab));
  $$(".panel-tab").forEach((p) => (p.hidden = p.dataset.tab !== tab));
  if (tab === "dashboard") refrescarDashboard();
  if (tab === "alertas") refrescarAlertas();
  if (tab === "usuarios") refrescarUsuarios();
}

// -------------------------------------------------------------- Dashboard --

function renderFiltrosDashboard() {
  const cont = $("#filtro-marcas");
  cont.innerHTML = "";
  for (const marca of estado.catalogo.marcas) {
    const label = document.createElement("label");
    label.className = "chip-filtro";
    label.innerHTML = `<input type="checkbox" value="${marca.codigo}" checked> ${marca.nombre}`;
    cont.appendChild(label);
  }
  cont.addEventListener("change", refrescarDashboard);

  const periodos = estado.catalogo.periodos;
  const selDesde = $("#filtro-periodo-desde");
  const selHasta = $("#filtro-periodo-hasta");
  selDesde.innerHTML = selHasta.innerHTML = periodos
    .map((p) => `<option value="${p.anio}-${String(p.mes).padStart(2, "0")}">${p.etiqueta}</option>`)
    .join("");
  if (periodos.length > 0) {
    selDesde.value = `${periodos[0].anio}-${String(periodos[0].mes).padStart(2, "0")}`;
    const ultimo = periodos[periodos.length - 1];
    selHasta.value = `${ultimo.anio}-${String(ultimo.mes).padStart(2, "0")}`;
  }
  selDesde.addEventListener("change", refrescarDashboard);
  selHasta.addEventListener("change", refrescarDashboard);
}

function marcasSeleccionadas() {
  return $$("#filtro-marcas input:checked").map((i) => i.value);
}

async function refrescarDashboard() {
  if (estado.catalogo.periodos.length === 0) {
    $("#dashboard-vacio").hidden = false;
    return;
  }
  $("#dashboard-vacio").hidden = true;
  const marcasSel = marcasSeleccionadas();
  const idsMarcaSel = estado.catalogo.marcas.filter((m) => marcasSel.includes(m.codigo)).map((m) => m.id);
  const periodoDesde = $("#filtro-periodo-desde").value;
  const periodoHasta = $("#filtro-periodo-hasta").value;

  let metricas = [];
  let historico = [];
  try {
    [{ filas: metricas }, { filas: historico }] = await Promise.all([
      window.InventarioAPI.metricas({ marca: idsMarcaSel.join(","), periodo_desde: periodoDesde, periodo_hasta: periodoHasta }),
      window.InventarioAPI.historicoMarca({ marca: idsMarcaSel.join(",") }),
    ]);
  } catch (err) {
    mensajeError("No se pudieron cargar los datos del dashboard.");
    return;
  }

  renderKpis(metricas);
  renderGraficaSerieMensual(metricas, historico);
  renderGraficaBarrasMarca(metricas);
  renderTablaHistorico(metricas);
}

function renderKpis(metricas) {
  const totalUnidades = metricas.reduce((a, f) => a + (f.uds_vendidas_actual || 0), 0);
  const totalCostoInv = metricas.reduce((a, f) => a + (f.costo_inv_actual || 0), 0);
  const moiValidos = metricas.map((f) => f.moi_cto_actual).filter((v) => typeof v === "number");
  const moiProm = moiValidos.length ? moiValidos.reduce((a, b) => a + b, 0) / moiValidos.length : null;

  $("#kpi-unidades").textContent = window.InventarioGraficas.formatoNumero(totalUnidades);
  $("#kpi-costo-inv").textContent = window.InventarioGraficas.formatoMoneda(totalCostoInv);
  $("#kpi-moi").textContent = moiProm != null ? `${moiProm.toFixed(1)} meses` : "—";
  $("#kpi-tiendas").textContent = window.InventarioGraficas.formatoNumero(new Set(metricas.map((f) => f.tienda_id)).size);
}

function agregarCostoInventarioPorMes(metricas, historico, marcasSel) {
  const mapa = new Map();
  for (const h of historico) {
    const codigo = h.inv_marcas?.codigo;
    if (marcasSel.length && !marcasSel.includes(codigo)) continue;
    mapa.set(`${codigo}|${h.anio}|${h.mes}`, h.costo_inventario);
  }
  const sumaDetalle = new Map();
  for (const f of metricas) {
    const codigo = f.inv_marcas?.codigo;
    if (marcasSel.length && !marcasSel.includes(codigo)) continue;
    const anio = f.inv_periodos?.anio, mes = f.inv_periodos?.mes;
    if (!anio || !mes) continue;
    const clave = `${codigo}|${anio}|${mes}`;
    sumaDetalle.set(clave, (sumaDetalle.get(clave) || 0) + (f.costo_inv_actual || 0));
  }
  for (const [clave, valor] of sumaDetalle) mapa.set(clave, valor); // el detalle real siempre gana sobre el backfill del mismo mes
  return [...mapa.entries()].map(([clave, valor]) => {
    const [marca, anio, mes] = clave.split("|");
    return { marca, anio: Number(anio), mes: Number(mes), valor };
  });
}

function renderGraficaSerieMensual(metricas, historico) {
  const marcasSel = marcasSeleccionadas();
  const puntos = agregarCostoInventarioPorMes(metricas, historico, marcasSel);
  window.InventarioGraficas.renderSerieMensualPorMarca("grafica-serie-mensual", puntos, {
    titulo: "Costo de inventario a cierre de mes, por marca",
    formateador: window.InventarioGraficas.formatoMoneda,
  });
}

function renderGraficaBarrasMarca(metricas) {
  const porMarca = new Map();
  for (const f of metricas) {
    const nombre = f.inv_marcas?.nombre || f.marca_id;
    porMarca.set(nombre, (porMarca.get(nombre) || 0) + (f.uds_vendidas_actual || 0));
  }
  const filas = [...porMarca.entries()].map(([etiqueta, valor]) => ({ etiqueta, valor })).sort((a, b) => b.valor - a.valor);
  window.InventarioGraficas.renderBarrasPorEtiqueta("grafica-barras-marca", filas, {
    titulo: "Unidades vendidas en el periodo filtrado, por marca",
  });
}

function renderTablaHistorico(metricas) {
  const tbody = $("#tabla-historico tbody");
  const filas = [...metricas].sort((a, b) => {
    const fa = a.inv_periodos?.fecha || "";
    const fb = b.inv_periodos?.fecha || "";
    return fb.localeCompare(fa) || (a.inv_tiendas?.codigo || "").localeCompare(b.inv_tiendas?.codigo || "");
  });
  tbody.innerHTML = filas
    .map(
      (f) => `<tr>
      <td>${f.inv_periodos?.etiqueta ?? ""}</td>
      <td>${f.inv_marcas?.nombre ?? ""}</td>
      <td>${f.inv_tiendas?.codigo ?? ""}</td>
      <td>${f.inv_tiendas?.canal ?? ""}</td>
      <td class="num">${window.InventarioGraficas.formatoNumero(f.uds_vendidas_actual)}</td>
      <td class="num">${window.InventarioGraficas.formatoMoneda(f.costo_inv_actual)}</td>
      <td class="num">${f.moi_cto_actual != null ? f.moi_cto_actual.toFixed(1) : "—"}</td>
      <td class="num">${window.InventarioGraficas.formatoPorcentaje(f.margen_prom_vta_actual)}</td>
      <td class="num">${f.anio_vs_anio != null ? window.InventarioGraficas.formatoPorcentaje(f.anio_vs_anio) : "—"}</td>
    </tr>`,
    )
    .join("");
}

// ------------------------------------------------------------------ Carga --

function initCarga() {
  const input = $("#input-archivo");
  const dropzone = $("#dropzone");
  input.addEventListener("change", () => input.files[0] && procesarArchivo(input.files[0]));
  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("arrastrando");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("arrastrando"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("arrastrando");
    if (e.dataTransfer.files[0]) procesarArchivo(e.dataTransfer.files[0]);
  });
  $("#btn-confirmar-carga").addEventListener("click", confirmarCargaPendiente);
  $("#btn-cancelar-carga").addEventListener("click", () => {
    estado.cargaPendiente = null;
    $("#resultado-carga").hidden = true;
    input.value = "";
  });
}

async function procesarArchivo(archivo) {
  $("#resultado-carga").hidden = false;
  $("#carga-estado").textContent = "Leyendo archivo…";
  $("#carga-advertencias").innerHTML = "";
  $("#carga-alertas").innerHTML = "";
  $("#btn-confirmar-carga").disabled = true;

  try {
    const buffer = await archivo.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
    const { formatoId, payload, advertencias } = window.InventarioParser.parsearWorkbook(workbook, archivo.name);

    if (!payload.periodo.anio) {
      $("#carga-estado").textContent = "No se pudo leer el periodo del archivo. Revísalo antes de continuar.";
      return;
    }

    $("#carga-estado").innerHTML = `Formato detectado: <strong>${formatoId}</strong> · Periodo: <strong>${payload.periodo.etiqueta}</strong> · ${payload.marcas.length} marca(s), ${payload.marcas.reduce((a, m) => a + m.tiendas.length, 0)} tienda(s) en total.`;
    renderListaTexto("#carga-advertencias", advertencias, "Sin advertencias de lectura del archivo.");

    $("#carga-estado").textContent += " Validando contra el histórico…";
    const previsualizacion = await window.InventarioAPI.previsualizarCarga(payload);
    estado.cargaPendiente = { payload, formatoId, advertencias, previsualizacion };
    renderAlertasPreview(previsualizacion.alertas);
    $("#btn-confirmar-carga").disabled = false;
    $("#carga-estado").innerHTML += ` <br>Listo para confirmar: ${previsualizacion.total_filas} filas, ${previsualizacion.total_alertas} alerta(s).`;
  } catch (err) {
    console.error(err);
    $("#carga-estado").textContent = `No se pudo procesar el archivo: ${err.message}`;
  }
}

function renderListaTexto(selector, items, textoVacio) {
  const el = $(selector);
  if (!items.length) {
    el.innerHTML = `<p class="texto-tenue">${textoVacio}</p>`;
    return;
  }
  el.innerHTML = `<ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;
}

function renderAlertasPreview(alertas) {
  const cont = $("#carga-alertas");
  if (!alertas.length) {
    cont.innerHTML = `<p class="texto-tenue">Sin alertas — los datos se ven consistentes contra el histórico y contra tiendas similares.</p>`;
    return;
  }
  cont.innerHTML = `<table class="tabla-alertas"><thead><tr><th>Severidad</th><th>Regla</th><th>Mensaje</th></tr></thead><tbody>${alertas
    .map((a) => `<tr class="sev-${a.severidad}"><td>${a.severidad}</td><td>${a.regla}</td><td>${a.mensaje}</td></tr>`)
    .join("")}</tbody></table>`;
}

async function confirmarCargaPendiente() {
  if (!estado.cargaPendiente) return;
  $("#btn-confirmar-carga").disabled = true;
  try {
    const resultado = await window.InventarioAPI.confirmarCarga(estado.cargaPendiente.payload);
    mensajeOk(`Carga guardada (${resultado.total_filas} filas, ${resultado.total_alertas} alerta(s)).`);
    estado.cargaPendiente = null;
    $("#resultado-carga").hidden = true;
    $("#input-archivo").value = "";
    estado.catalogo = await window.InventarioAPI.catalogo();
    renderFiltrosDashboard();
  } catch (err) {
    mensajeError(`No se pudo guardar la carga: ${err.message}`);
    $("#btn-confirmar-carga").disabled = false;
  }
}

// --------------------------------------------------------------- Alertas --

async function refrescarAlertas() {
  const soloAbiertas = $("#filtro-alertas-abiertas").checked;
  let alertas = [];
  try {
    ({ alertas } = await window.InventarioAPI.alertas(soloAbiertas ? { resuelta: "false" } : {}));
  } catch (err) {
    mensajeError("No se pudieron cargar las alertas.");
    return;
  }
  const tbody = $("#tabla-alertas-global tbody");
  const esEditor = estado.sesion.rol === "editor";
  tbody.innerHTML = alertas
    .map(
      (a) => `<tr class="sev-${a.severidad}">
      <td>${a.inv_periodos?.etiqueta ?? ""}</td>
      <td>${a.inv_marcas?.nombre ?? ""}</td>
      <td>${a.inv_tiendas?.codigo ?? ""}</td>
      <td>${a.severidad}</td>
      <td>${a.mensaje}</td>
      <td>${a.resuelta ? `Resuelta por ${a.resuelta_por ?? ""}` : esEditor ? `<button data-id="${a.id}" class="btn-resolver">Marcar resuelta</button>` : "Abierta"}</td>
    </tr>`,
    )
    .join("");
  $$(".btn-resolver").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await window.InventarioAPI.resolverAlerta(btn.dataset.id, true);
        refrescarAlertas();
      } catch (err) {
        mensajeError("No se pudo marcar la alerta como resuelta.");
      }
    }),
  );
}

// -------------------------------------------------------------- Usuarios --

function initUsuarios() {
  $("#form-nuevo-usuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = $("#nuevo-usuario-nombre").value.trim();
    const rol = $("#nuevo-usuario-rol").value;
    const palabraClave = $("#nuevo-usuario-palabra-clave").value.trim();
    try {
      await window.InventarioAPI.crearUsuario(nombre, rol, palabraClave);
      mensajeOk(`Usuario "${nombre}" creado. Comparte la palabra clave por un canal seguro (no por aquí).`);
      $("#form-nuevo-usuario").reset();
      refrescarUsuarios();
    } catch (err) {
      mensajeError(`No se pudo crear el usuario: ${err.message}`);
    }
  });
}

async function refrescarUsuarios() {
  let usuarios = [];
  try {
    ({ usuarios } = await window.InventarioAPI.usuarios());
  } catch (err) {
    mensajeError("No se pudo cargar la lista de usuarios.");
    return;
  }
  const tbody = $("#tabla-usuarios tbody");
  tbody.innerHTML = usuarios
    .map(
      (u) => `<tr>
      <td>${u.nombre}</td>
      <td>${u.rol}</td>
      <td>${u.activo ? "Activo" : "Desactivado"}</td>
      <td>${u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleString("es-MX") : "Nunca"}</td>
      <td><button data-id="${u.id}" data-activo="${u.activo}" class="btn-toggle-usuario">${u.activo ? "Desactivar" : "Reactivar"}</button></td>
    </tr>`,
    )
    .join("");
  $$(".btn-toggle-usuario").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const nuevoValor = btn.dataset.activo !== "true";
      try {
        await window.InventarioAPI.cambiarActivoUsuario(btn.dataset.id, nuevoValor);
        refrescarUsuarios();
      } catch (err) {
        mensajeError("No se pudo actualizar el usuario.");
      }
    }),
  );
}

document.addEventListener("DOMContentLoaded", () => {
  init();
  initCarga();
  initUsuarios();
});
