// Capa de persistencia. Hoy: localStorage (modo demo, un dispositivo).
// Mañana: Supabase — misma interfaz (cargar/guardar/sesión), y las
// operaciones de dinero pasan a funciones RPC en Postgres
// (ver supabase/migrations/001_esquema.sql). La UI no debe enterarse.
import * as M from './motor.js';

const CLAVE = 'duelo_estado_v1';
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
  const evs = [
    M.crearEvento(e, { titulo: 'América vs Chivas', liga: 'Liga MX', opciones: ['América', 'Chivas'], inicia: en(1, 21) }),
    M.crearEvento(e, { titulo: 'Tigres vs Monterrey', liga: 'Liga MX', opciones: ['Tigres', 'Monterrey'], inicia: en(2, 19) }),
    M.crearEvento(e, { titulo: 'Chiefs vs Cowboys', liga: 'NFL', opciones: ['Chiefs', 'Cowboys'], inicia: en(3, 15) }),
    M.crearEvento(e, { titulo: 'Lakers vs Celtics', liga: 'NBA', opciones: ['Lakers', 'Celtics'], inicia: en(1, 20) }),
    M.crearEvento(e, { titulo: 'Pelea estelar (round a round)', liga: 'Box', opciones: ['Esquina roja', 'Esquina azul'], inicia: en(5, 22) }),
  ];
  const a = M.registrarUsuario(e, { nombre: 'Rival Demo A' });
  const b = M.registrarUsuario(e, { nombre: 'Rival Demo B' });
  M.crearReto(e, { creadorId: a.id, eventoId: evs[0].id, lado: 0, monto: 20000 });
  M.crearReto(e, { creadorId: b.id, eventoId: evs[0].id, lado: 1, monto: 50000, montoRival: 40000 });
  M.crearReto(e, { creadorId: a.id, eventoId: evs[2].id, lado: 1, monto: 10000 });
  M.crearReto(e, { creadorId: b.id, eventoId: evs[3].id, lado: 0, monto: 30000 });
  e.demo = { bots: [a.id, b.id] };
  return e;
}
