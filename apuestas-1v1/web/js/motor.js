// Motor de apuestas 1 vs 1 — lógica pura, sin DOM ni red.
// Corre igual en el navegador (ES module) y en Node (tests).
//
// Principios:
//  1. Todo el dinero se maneja en CENTAVOS enteros (nunca floats).
//  2. Contabilidad de partida doble: cada operación es un asiento cuyas
//     líneas suman CERO entre cuentas. Así el dinero nunca se crea ni se
//     pierde por un bug: si la suma global ≠ 0, algo está mal.
//  3. Cuentas: "u:<id>" (saldo disponible de cada usuario), "escrow"
//     (dinero bloqueado en retos activos), "casa" (nuestras comisiones),
//     "externo" (el mundo de afuera: depósitos/retiros/bonos).
//  4. La casa NUNCA toma postura: solo cobra comisión sobre el bote.

export const CONFIG = {
  tasaComision: 0.05,      // 5% del bote total, cobrado al liquidar
  apuestaMinima: 1000,     // $10.00
  apuestaMaxima: 500000,   // $5,000.00
  bonoBienvenida: 100000,  // $1,000.00 en fichas demo (modo sin dinero real)
};

export class ErrorMotor extends Error {}
const falla = (msg) => { throw new ErrorMotor(msg); };

let contador = 0;
export const nuevoId = (prefijo) =>
  `${prefijo}_${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function crearEstado() {
  return { usuarios: {}, eventos: {}, retos: {}, asientos: [] };
}

// ---------- Libro mayor ----------

function asentar(estado, tipo, lineas, ref = {}) {
  const suma = lineas.reduce((s, l) => s + l.monto, 0);
  if (suma !== 0) falla(`Asiento descuadrado (${suma})`);
  for (const l of lineas) if (!Number.isInteger(l.monto)) falla('Montos deben ser centavos enteros');
  const asiento = { id: nuevoId('as'), tipo, lineas, ref, fecha: new Date().toISOString() };
  estado.asientos.push(asiento);
  return asiento;
}

export function saldo(estado, cuenta) {
  let s = 0;
  for (const a of estado.asientos) for (const l of a.lineas) if (l.cuenta === cuenta) s += l.monto;
  return s;
}

export const saldoUsuario = (estado, usuarioId) => saldo(estado, `u:${usuarioId}`);

export function verificarCuadre(estado) {
  let total = 0;
  for (const a of estado.asientos) for (const l of a.lineas) total += l.monto;
  return total === 0;
}

export function movimientosDe(estado, usuarioId) {
  const cuenta = `u:${usuarioId}`;
  const out = [];
  for (const a of estado.asientos) {
    const monto = a.lineas.filter((l) => l.cuenta === cuenta).reduce((s, l) => s + l.monto, 0);
    if (monto !== 0) out.push({ id: a.id, tipo: a.tipo, monto, fecha: a.fecha, ref: a.ref });
  }
  return out.reverse();
}

// ---------- Usuarios y billetera ----------

export function registrarUsuario(estado, { nombre, email, esAdmin = false }, cfg = CONFIG) {
  if (!nombre?.trim()) falla('Falta el nombre');
  const id = nuevoId('usr');
  estado.usuarios[id] = { id, nombre: nombre.trim(), email: email?.trim() || '', esAdmin, creado: new Date().toISOString() };
  if (cfg.bonoBienvenida > 0) {
    asentar(estado, 'bono', [
      { cuenta: 'externo', monto: -cfg.bonoBienvenida },
      { cuenta: `u:${id}`, monto: cfg.bonoBienvenida },
    ], { usuarioId: id });
  }
  return estado.usuarios[id];
}

export function depositar(estado, usuarioId, monto) {
  if (!estado.usuarios[usuarioId]) falla('Usuario no existe');
  if (!Number.isInteger(monto) || monto <= 0) falla('Monto inválido');
  return asentar(estado, 'deposito', [
    { cuenta: 'externo', monto: -monto },
    { cuenta: `u:${usuarioId}`, monto },
  ], { usuarioId });
}

export function retirar(estado, usuarioId, monto) {
  if (!Number.isInteger(monto) || monto <= 0) falla('Monto inválido');
  if (saldoUsuario(estado, usuarioId) < monto) falla('Saldo insuficiente');
  return asentar(estado, 'retiro', [
    { cuenta: `u:${usuarioId}`, monto: -monto },
    { cuenta: 'externo', monto },
  ], { usuarioId });
}

// ---------- Eventos ----------

export function crearEvento(estado, { titulo, liga, opciones, inicia }) {
  if (!titulo?.trim()) falla('Falta el título');
  if (!Array.isArray(opciones) || opciones.length !== 2) falla('Un evento 1v1 tiene exactamente 2 opciones');
  const id = nuevoId('evt');
  estado.eventos[id] = { id, titulo: titulo.trim(), liga: liga || 'Otro', opciones, inicia, estado: 'abierto', resultado: null };
  return estado.eventos[id];
}

export function cerrarEvento(estado, eventoId) {
  const ev = estado.eventos[eventoId] || falla('Evento no existe');
  if (ev.estado !== 'abierto') falla('El evento no está abierto');
  ev.estado = 'cerrado'; // ya empezó: no se crean ni aceptan retos nuevos
  return ev;
}

// ---------- Retos 1v1 ----------

// El creador elige un lado y cuánto pone. `montoRival` es lo que debe poner
// quien acepte (por defecto igual = momio parejo; distinto = momio propio).
export function crearReto(estado, { creadorId, eventoId, lado, monto, montoRival = monto, privado = false }, cfg = CONFIG) {
  const ev = estado.eventos[eventoId] || falla('Evento no existe');
  if (ev.estado !== 'abierto') falla('El evento ya no acepta retos');
  if (lado !== 0 && lado !== 1) falla('Lado inválido');
  for (const m of [monto, montoRival]) {
    if (!Number.isInteger(m)) falla('Monto inválido');
    if (m < cfg.apuestaMinima) falla(`La apuesta mínima es ${fmt(cfg.apuestaMinima)}`);
    if (m > cfg.apuestaMaxima) falla(`La apuesta máxima es ${fmt(cfg.apuestaMaxima)}`);
  }
  if (saldoUsuario(estado, creadorId) < monto) falla('Saldo insuficiente');
  const id = nuevoId('rto');
  estado.retos[id] = {
    id, eventoId, creadorId, lado, monto, montoRival, privado,
    rivalId: null, estado: 'abierto', ganadorId: null, comision: 0,
    creado: new Date().toISOString(),
  };
  asentar(estado, 'bloqueo', [
    { cuenta: `u:${creadorId}`, monto: -monto },
    { cuenta: 'escrow', monto },
  ], { retoId: id });
  return estado.retos[id];
}

export function aceptarReto(estado, retoId, rivalId) {
  const r = estado.retos[retoId] || falla('Reto no existe');
  if (r.estado !== 'abierto') falla('Este reto ya no está disponible');
  if (r.creadorId === rivalId) falla('No puedes aceptar tu propio reto');
  if (estado.eventos[r.eventoId].estado !== 'abierto') falla('El evento ya empezó');
  if (saldoUsuario(estado, rivalId) < r.montoRival) falla('Saldo insuficiente');
  asentar(estado, 'bloqueo', [
    { cuenta: `u:${rivalId}`, monto: -r.montoRival },
    { cuenta: 'escrow', monto: r.montoRival },
  ], { retoId });
  r.rivalId = rivalId;
  r.estado = 'emparejado';
  return r;
}

export function cancelarReto(estado, retoId, usuarioId) {
  const r = estado.retos[retoId] || falla('Reto no existe');
  if (r.creadorId !== usuarioId) falla('Solo quien creó el reto puede cancelarlo');
  if (r.estado !== 'abierto') falla('Solo se cancelan retos que nadie ha aceptado');
  reembolsar(estado, r, 'cancelado');
  return r;
}

function reembolsar(estado, r, nuevoEstado) {
  const lineas = [{ cuenta: `u:${r.creadorId}`, monto: r.monto }];
  let total = r.monto;
  if (r.rivalId) { lineas.push({ cuenta: `u:${r.rivalId}`, monto: r.montoRival }); total += r.montoRival; }
  lineas.push({ cuenta: 'escrow', monto: -total });
  asentar(estado, 'reembolso', lineas, { retoId: r.id });
  r.estado = nuevoEstado;
}

export const comisionDe = (bote, cfg = CONFIG) => Math.round(bote * cfg.tasaComision);

// resultado: 0 | 1 (índice de la opción ganadora) o 'anulado' (empate,
// suspendido, etc.) → se devuelve todo sin comisión.
export function resolverEvento(estado, eventoId, resultado, cfg = CONFIG) {
  const ev = estado.eventos[eventoId] || falla('Evento no existe');
  if (ev.estado === 'resuelto' || ev.estado === 'anulado') falla('El evento ya se resolvió');
  if (![0, 1, 'anulado'].includes(resultado)) falla('Resultado inválido');
  const resumen = { liquidados: 0, reembolsados: 0, comisionTotal: 0 };

  for (const r of Object.values(estado.retos)) {
    if (r.eventoId !== eventoId) continue;
    if (r.estado === 'abierto') { reembolsar(estado, r, 'expirado'); resumen.reembolsados++; continue; }
    if (r.estado !== 'emparejado') continue;
    if (resultado === 'anulado') { reembolsar(estado, r, 'anulado'); resumen.reembolsados++; continue; }

    const bote = r.monto + r.montoRival;
    const comision = comisionDe(bote, cfg);
    const ganadorId = resultado === r.lado ? r.creadorId : r.rivalId;
    asentar(estado, 'liquidacion', [
      { cuenta: 'escrow', monto: -bote },
      { cuenta: `u:${ganadorId}`, monto: bote - comision },
      { cuenta: 'casa', monto: comision },
    ], { retoId: r.id });
    Object.assign(r, { estado: 'liquidado', ganadorId, comision });
    resumen.liquidados++;
    resumen.comisionTotal += comision;
  }
  ev.estado = resultado === 'anulado' ? 'anulado' : 'resuelto';
  ev.resultado = resultado;
  return resumen;
}

// ---------- Utilidades ----------

export const aCentavos = (pesos) => Math.round(Number(pesos) * 100);
export const fmt = (centavos) =>
  (centavos / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });

export function metricasCasa(estado) {
  const retos = Object.values(estado.retos);
  const emparejados = retos.filter((r) => r.rivalId);
  return {
    usuarios: Object.keys(estado.usuarios).length,
    retosCreados: retos.length,
    retosEmparejados: emparejados.length,
    tasaEmparejamiento: retos.length ? emparejados.length / retos.length : 0,
    volumen: emparejados.reduce((s, r) => s + r.monto + r.montoRival, 0),
    enEscrow: saldo(estado, 'escrow'),
    ingresosCasa: saldo(estado, 'casa'),
    cuadra: verificarCuadre(estado),
  };
}
