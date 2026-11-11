// Capa de persistencia. Hoy: localStorage (modo demo, un dispositivo).
// Mañana: Supabase — misma interfaz (cargar/guardar/sesión), y las
// operaciones de dinero pasan a funciones RPC en Postgres
// (ver supabase/migrations/001_esquema.sql). La UI no debe enterarse.
import * as M from './motor.js';

const CLAVE = 'duelo_estado_v2'; // v2: momios, depósitos y retiros
const CLAVE_SESION = 'duelo_sesion_v1';

export function cargar() {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (raw) return JSON.parse(raw);
  } catch { /* almacenamiento bloqueado o corrupto: arrancamos limpio */ }
  return sembrar(M.crearEstado());
}

export function guardar(estado) {
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* sin persistencia */ }
}

export const sesion = {
  get: () => { try { return localStorage.getItem(CLAVE_SESION); } catch { return null; } },
  set: (id) => { try { id ? localStorage.setItem(CLAVE_SESION, id) : localStorage.removeItem(CLAVE_SESION); } catch {} },
};

export function reiniciar() {
  try { localStorage.removeItem(CLAVE); localStorage.removeItem(CLAVE_SESION); } catch {}
}

// Datos de ejemplo para que el lobby no se vea vacío en la demo.
function sembrar(e) {
  const en = (dias, hora) => { const d = new Date(); d.setDate(d.getDate() + dias); d.setHours(hora, 0, 0, 0); return d.toISOString(); };
  // probabilidades = referencia del mercado (en producción vienen de un feed de momios)
  const evs = [
    M.crearEvento(e, { titulo: 'América vs Chivas', liga: 'Liga MX', opciones: ['América', 'Chivas'], inicia: en(1, 21), probabilidades: [0.58, 0.42] }),
    M.crearEvento(e, { titulo: 'Tigres vs Monterrey', liga: 'Liga MX', opciones: ['Tigres', 'Monterrey'], inicia: en(2, 19), probabilidades: [0.5, 0.5] }),
    M.crearEvento(e, { titulo: 'Chiefs vs Cowboys', liga: 'NFL', opciones: ['Chiefs', 'Cowboys'], inicia: en(3, 15), probabilidades: [0.7, 0.3] }),
    M.crearEvento(e, { titulo: 'Lakers vs Celtics', liga: 'NBA', opciones: ['Lakers', 'Celtics'], inicia: en(1, 20), probabilidades: [0.38, 0.62] }),
    M.crearEvento(e, { titulo: 'Pelea estelar', liga: 'Box', opciones: ['Esquina roja', 'Esquina azul'], inicia: en(5, 22), probabilidades: [0.75, 0.25] }),
  ];
  const a = M.registrarUsuario(e, { nombre: 'Rival Demo A' });
  const b = M.registrarUsuario(e, { nombre: 'Rival Demo B' });
  M.crearReto(e, { creadorId: a.id, eventoId: evs[0].id, lado: 0, monto: 20000 });                      // parejo
  M.crearReto(e, { creadorId: b.id, eventoId: evs[0].id, lado: 1, monto: 10000, montoRival: 15000 });   // da momio al favorito
  M.crearReto(e, { creadorId: a.id, eventoId: evs[2].id, lado: 0, monto: 30000, montoRival: 10000 });   // 3 a 1 por el favorito
  M.crearReto(e, { creadorId: b.id, eventoId: evs[4].id, lado: 1, monto: 5000, montoRival: 20000 });   // 4 a 1 por el no favorito
  M.crearReto(e, { creadorId: a.id, eventoId: evs[3].id, lado: 1, monto: 20000, montoRival: 12000 });
  e.demo = { bots: [a.id, b.id] };
  return e;
}
