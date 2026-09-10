// Cliente delgado para las Edge Functions de app-inventario. El "login" no
// es Supabase Auth: es una palabra clave que canjea un token propio
// (firmado en el servidor, ver supabase/functions/_shared/auth.ts) que
// mandamos como Bearer en cada llamada. Por eso estas Edge Functions se
// despliegan con verify_jwt=false (el gateway de Supabase no debe intentar
// validar nuestro token como si fuera un JWT de Supabase) — ver README.md.

const SESION_KEY = "inv_sesion";

function leerSesion() {
  try {
    const raw = localStorage.getItem(SESION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function guardarSesion(sesion) {
  localStorage.setItem(SESION_KEY, JSON.stringify(sesion));
}

function borrarSesion() {
  localStorage.removeItem(SESION_KEY);
}

async function llamar(nombreFuncion, { method = "GET", body, params } = {}) {
  let url = `${window.INVENTARIO_FUNCTIONS_BASE}/${nombreFuncion}`;
  if (params) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ""));
    const qsStr = qs.toString();
    if (qsStr) url += `?${qsStr}`;
  }
  const sesion = leerSesion();
  const headers = { "Content-Type": "application/json" };
  if (sesion?.token) headers.Authorization = `Bearer ${sesion.token}`;

  const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  if (!resp.ok) {
    if (resp.status === 401) borrarSesion();
    const mensaje = data?.error || `Error ${resp.status}`;
    throw new Error(mensaje);
  }
  return data;
}

window.InventarioAPI = {
  leerSesion,
  guardarSesion,
  borrarSesion,

  async login(palabraClave) {
    const data = await llamar("inventario-login", { method: "POST", body: { palabra_clave: palabraClave } });
    guardarSesion({ token: data.token, nombre: data.nombre, rol: data.rol });
    return data;
  },

  logout() {
    borrarSesion();
  },

  catalogo: () => llamar("inventario-datos", { params: { vista: "catalogo" } }),
  metricas: (filtros) => llamar("inventario-datos", { params: { vista: "metricas", ...filtros } }),
  cedisTransito: (filtros) => llamar("inventario-datos", { params: { vista: "cedis_transito", ...filtros } }),
  historicoMarca: (filtros) => llamar("inventario-datos", { params: { vista: "historico_marca", ...filtros } }),

  previsualizarCarga: (payload) => llamar("inventario-cargar", { method: "POST", body: { ...payload, dry_run: true } }),
  confirmarCarga: (payload) => llamar("inventario-cargar", { method: "POST", body: { ...payload, dry_run: false } }),

  alertas: (filtros) => llamar("inventario-alertas", { params: filtros }),
  resolverAlerta: (id, resuelta) => llamar("inventario-alertas", { method: "PATCH", body: { id, resuelta } }),

  usuarios: () => llamar("inventario-usuarios"),
  crearUsuario: (nombre, rol, palabra_clave) => llamar("inventario-usuarios", { method: "POST", body: { nombre, rol, palabra_clave } }),
  cambiarActivoUsuario: (id, activo) => llamar("inventario-usuarios", { method: "PATCH", body: { id, activo } }),
};
