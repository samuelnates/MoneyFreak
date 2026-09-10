// Helpers de gráficas (Chart.js). Registro simple pensado para poder sumar
// nuevos tipos de gráfica más adelante sin tocar los que ya funcionan: cada
// entrada de DEFINICIONES_GRAFICA solo necesita un id, un título y una
// función build(datos) que arme el config de Chart.js.

const PALETA = ["#2563eb", "#d97706", "#059669", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
function colorMarca(indice) {
  return PALETA[indice % PALETA.length];
}

function formatoMoneda(valor) {
  if (valor == null) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(valor);
}
function formatoNumero(valor) {
  if (valor == null) return "—";
  return new Intl.NumberFormat("es-MX").format(Math.round(valor));
}
function formatoPorcentaje(valor) {
  if (valor == null) return "—";
  return `${(valor * 100).toFixed(1)}%`;
}

const registroCharts = new Map();
function destruirSiExiste(canvasId) {
  const previo = registroCharts.get(canvasId);
  if (previo) previo.destroy();
}

// Línea: una serie por marca, eje X = "Mes Año". `puntos` = [{marca, mes, anio, valor}]
function renderSerieMensualPorMarca(canvasId, puntos, { titulo, formateador = formatoNumero } = {}) {
  destruirSiExiste(canvasId);
  const marcas = [...new Set(puntos.map((p) => p.marca))];
  const clavesMes = [...new Set(puntos.map((p) => `${p.anio}-${String(p.mes).padStart(2, "0")}`))].sort();
  const etiquetas = clavesMes.map((c) => {
    const [anio, mes] = c.split("-");
    return `${window.InventarioParser.NOMBRE_MES[Number(mes)]} ${anio}`;
  });
  const datasets = marcas.map((marca, i) => ({
    label: marca,
    data: clavesMes.map((c) => {
      const [anio, mes] = c.split("-").map(Number);
      const punto = puntos.find((p) => p.marca === marca && p.anio === anio && p.mes === mes);
      return punto ? punto.valor : null;
    }),
    borderColor: colorMarca(i),
    backgroundColor: colorMarca(i),
    spanGaps: true,
    tension: 0.25,
  }));
  const ctx = document.getElementById(canvasId);
  const chart = new Chart(ctx, {
    type: "line",
    data: { labels: etiquetas, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { title: { display: !!titulo, text: titulo }, legend: { position: "bottom" } },
      scales: { y: { ticks: { callback: (v) => formateador(v) } } },
    },
  });
  registroCharts.set(canvasId, chart);
  return chart;
}

// Barras: una barra por marca (o por tienda), un solo valor cada una.
function renderBarrasPorEtiqueta(canvasId, filas, { titulo, formateador = formatoNumero } = {}) {
  destruirSiExiste(canvasId);
  const ctx = document.getElementById(canvasId);
  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: filas.map((f) => f.etiqueta),
      datasets: [{
        data: filas.map((f) => f.valor),
        backgroundColor: filas.map((_, i) => colorMarca(i)),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { title: { display: !!titulo, text: titulo }, legend: { display: false } },
      scales: { y: { ticks: { callback: (v) => formateador(v) } } },
    },
  });
  registroCharts.set(canvasId, chart);
  return chart;
}

window.InventarioGraficas = {
  renderSerieMensualPorMarca,
  renderBarrasPorEtiqueta,
  formatoMoneda,
  formatoNumero,
  formatoPorcentaje,
  colorMarca,
};
