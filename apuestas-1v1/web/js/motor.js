// Motor de apuestas 1 vs 1 — lógica pura, sin DOM ni red.
// Corre igual en el navegador (ES module) y en Node (tests).
//
// Principios:
//  1. Todo el dinero se maneja en CENTAVOS enteros (nunca floats).
//  2. Contabilidad de partida doble: cada operación es un asiento cuyas
//     líneas suman CERO entre cuentas. Si la suma global ≠ 0, hay un bug.
//  3. Cuentas: "u:<id>" (saldo disponible de cada usuario), "escrow"
//     (dinero comprometido en retos), "retiros" (retiros en revisión),
//     "casa" (nuestro resultado: comisiones − costos de pago),
//     "externo" (el mundo de afuera: bancos, OXXO, tarjetas).
//  4. La casa NUNCA toma postura: solo cobra comisión.
//  5. Un reto aceptado es un COMPROMISO: no se cancela, solo se liquida
//     (o se anula si el evento se suspende).

export const CONFIG = {
  // Comisión mínima: % de la GANANCIA NETA del ganador (lo que puso el que
  // perdió), no del bote. Así un momio 100 vs 50 no castiga a quien gana poco.
  tasaComision: 0.05,
  apuestaMinima: 1000,     // $10
  apuestaMaxima: 500000,   // $5,000 por lado
  ratioMaximo: 10,         // momio máximo 10 a 1 (más que eso = señal de lavado / chip dumping)
  bonoBienvenida: 100000,  // $1,000 en fichas demo (0 con dinero real)
  limiteDepositoDiario: 2000000, // $20,000 por usuario cada 24 h (juego responsable)
  retiro: {
    tasa: 0.02,            // 2% del monto retirado…
    minimo: 1500,          // …con mínimo de $15
    montoMinimo: 10000,    // no se retiran menos de $100
    rollover: 1,           // hay que apostar al menos 1x lo depositado antes de retirar (antilavado)
    revisionManualDesde: 1000000, // retiros ≥ $10,000 siempre los revisa una persona
  },
  metodosDeposito: {
    spei:    { nombre: 'Transferencia SPEI', detalle: 'Llega en minutos · 24/7', min: 5000, max: 5000000, inmediato: true,  costo: { tasa: 0,     fijo: 800 } },
    tarjeta: { nombre: 'Tarjeta de débito o crédito', detalle: 'Inmediato · Visa, Mastercard, Amex', min: 5000, max: 2000000, inmediato: true,  costo: { tasa: 0.036, fijo: 300 } },
    oxxo:    { nombre: 'Efectivo en OXXO', detalle: 'Pagas con referencia · se acredita en ~1 h', min: 5000, max: 1000000, inmediato: false, costo: { tasa: 0.035, fijo: 0 } },
  },
  costoPagoRetiro: 800,    // lo que nos cuesta mandar un SPEI de salida
};

export class ErrorMotor extends Error {}
const falla = (msg) => { throw new ErrorMotor(msg); };

let contador = 0;
export const nuevoId = (prefijo) =>
  `${prefijo}_${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function crearEstado() {
  return { usuarios: {}, eventos: {}, retos: {}, depositos: {}, retiros: {}, asientos: [], bitacora: [] };
}

// ---------- Libro mayor ----------

function asentar(estado, tipo, lineas, ref = {}) {
  for (const l of lineas) if (!Number.isInteger(l.monto)) falla('Montos deben ser centavos enteros');
  const suma = lineas.reduce((s, l) => s + l.monto, 0);
  if (suma !== 0) falla(`Asiento descuadrado (${suma})`);
  const asiento = { id: nuevoId('as'), tipo, lineas: lineas.filter((l) => l.monto !== 0), ref, fecha: new Date().toISOString() };
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

function registrarBitacora(estado, actorId, accion, detalle) {
  estado.bitacora.push({ fecha: new Date().toISOString(), actorId: actorId || 'sistema', accion, detalle });
}

function exigirAdmin(estado, actorId) {
  if (actorId == null) return; // null = proceso del sistema (cron / webhook con llave de servidor)
  if (!estado.usuarios[actorId]?.esAdmin) falla('Solo administradores');
}

function exigirActivo(estado, usuarioId) {
  const u = estado.usuarios[usuarioId] || falla('Usuario no existe');
  if (u.autoexcluidoHasta && new Date(u.autoexcluidoHasta) > new Date()) falla('Tu cuenta está en pausa por autoexclusión');
  return u;
}

// ---------- Usuarios ----------

export function registrarUsuario(estado, { nombre, email, esAdmin = false }, cfg = CONFIG) {
  if (!nombre?.trim()) falla('Falta el nombre');
  const id = nuevoId('usr');
  estado.usuarios[id] = { id, nombre: nombre.trim().slice(0, 30), email: email?.trim() || '', esAdmin, autoexcluidoHasta: null, creado: new Date().toISOString() };
  if (cfg.bonoBienvenida > 0) {
    asentar(estado, 'bono', [
      { cuenta: 'externo', monto: -cfg.bonoBienvenida },
      { cuenta: `u:${id}`, monto: cfg.bonoBienvenida },
    ], { usuarioId: id });
  }
  return estado.usuarios[id];
}

export function autoexcluir(estado, usuarioId, dias) {
  const u = estado.usuarios[usuarioId] || falla('Usuario no existe');
  if (!(dias > 0)) falla('Días inválidos');
  u.autoexcluidoHasta = new Date(Date.now() + dias * 864e5).toISOString();
  registrarBitacora(estado, usuarioId, 'autoexclusion', { dias });
  return u;
}

// ---------- Depósitos (OXXO, tarjeta, SPEI) ----------
// Flujo real: iniciarDeposito (la app) → el proveedor cobra → webhook firmado
// → confirmarDeposito. El saldo SOLO sube cuando el proveedor confirma.

export const costoDeposito = (metodo, monto, cfg = CONFIG) =>
  Math.round(monto * cfg.metodosDeposito[metodo].costo.tasa) + cfg.metodosDeposito[metodo].costo.fijo;

export function iniciarDeposito(estado, usuarioId, monto, metodo, cfg = CONFIG) {
  exigirActivo(estado, usuarioId);
  const m = cfg.metodosDeposito[metodo] || falla('Método de pago no disponible');
  if (!Number.isInteger(monto) || monto < m.min) falla(`El mínimo con ${m.nombre} es ${fmt(m.min)}`);
  if (monto > m.max) falla(`El máximo con ${m.nombre} es ${fmt(m.max)}`);
  const hace24h = Date.now() - 864e5;
  const ultimas24 = Object.values(estado.depositos)
    .filter((d) => d.usuarioId === usuarioId && d.estado !== 'fallido' && new Date(d.creado) > hace24h)
    .reduce((s, d) => s + d.monto, 0);
  if (ultimas24 + monto > cfg.limiteDepositoDiario) falla(`Límite diario de depósito: ${fmt(cfg.limiteDepositoDiario)}`);
  const id = nuevoId('dep');
  const referencia = metodo === 'oxxo' ? Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join('') : null;
  estado.depositos[id] = { id, usuarioId, monto, metodo, estado: 'pendiente', referencia, idProveedor: null, creado: new Date().toISOString() };
  return estado.depositos[id];
}

// Idempotente: el proveedor puede mandar el mismo webhook varias veces.
export function confirmarDeposito(estado, depositoId, idProveedor, cfg = CONFIG) {
  const d = estado.depositos[depositoId] || falla('Depósito no existe');
  if (!idProveedor) falla('Falta el id del proveedor');
  if (d.estado === 'acreditado') {
    if (d.idProveedor !== idProveedor) falla('Depósito ya acreditado con otro pago');
    return d; // repetido: no se acredita dos veces
  }
  if (d.estado !== 'pendiente') falla('Depósito no está pendiente');
  if (Object.values(estado.depositos).some((x) => x.idProveedor === idProveedor)) falla('Ese pago ya se usó en otro depósito');
  const costo = costoDeposito(d.metodo, d.monto, cfg);
  asentar(estado, 'deposito', [
    { cuenta: 'externo', monto: -d.monto },
    { cuenta: `u:${d.usuarioId}`, monto: d.monto },
    { cuenta: 'casa', monto: -costo },   // el costo del procesador lo absorbe la casa
    { cuenta: 'externo', monto: costo },
  ], { depositoId, usuarioId: d.usuarioId, metodo: d.metodo });
  Object.assign(d, { estado: 'acreditado', idProveedor, acreditado: new Date().toISOString() });
  return d;
}

export function fallarDeposito(estado, depositoId) {
  const d = estado.depositos[depositoId] || falla('Depósito no existe');
  if (d.estado !== 'pendiente') falla('Depósito no está pendiente');
  d.estado = 'fallido';
  return d;
}

// ---------- Retiros ----------

// CLABE: 18 dígitos, el último es dígito verificador (pesos 3,7,1).
export function validarClabe(clabe) {
  const c = String(clabe || '').replace(/\s/g, '');
  if (!/^\d{18}$/.test(c)) return false;
  const pesos = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(c[i]) * pesos[i % 3]) % 10;
  return (10 - (suma % 10)) % 10 === Number(c[17]);
}

export const comisionRetiro = (monto, cfg = CONFIG) => Math.max(cfg.retiro.minimo, Math.round(monto * cfg.retiro.tasa));

// Lo que el usuario ha metido (depósitos + bonos) vs lo que ha apostado en
// retos que sí se emparejaron. Regla antilavado: no se puede depositar y
// retirar sin jugar.
export function rolloverDe(estado, usuarioId, cfg = CONFIG) {
  const fondeado = estado.asientos
    .filter((a) => a.tipo === 'deposito' || a.tipo === 'bono')
    .reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === `u:${usuarioId}`).reduce((x, l) => x + l.monto, 0), 0);
  const apostado = Object.values(estado.retos).reduce((s, r) => {
    if (!r.rivalId) return s;
    if (r.creadorId === usuarioId) return s + r.monto;
    if (r.rivalId === usuarioId) return s + r.montoRival;
    return s;
  }, 0);
  const requerido = Math.round(fondeado * cfg.retiro.rollover);
  return { fondeado, apostado, requerido, cumple: apostado >= requerido, faltante: Math.max(0, requerido - apostado) };
}

export function solicitarRetiro(estado, usuarioId, monto, clabe, cfg = CONFIG) {
  exigirActivo(estado, usuarioId);
  if (!Number.isInteger(monto) || monto < cfg.retiro.montoMinimo) falla(`El retiro mínimo es ${fmt(cfg.retiro.montoMinimo)}`);
  if (!validarClabe(clabe)) falla('La CLABE no es válida (revisa los 18 dígitos)');
  if (saldoUsuario(estado, usuarioId) < monto) falla('Saldo insuficiente');
  const ro = rolloverDe(estado, usuarioId, cfg);
  if (!ro.cumple) falla(`Para retirar primero apuesta ${fmt(ro.faltante)} más (regla antilavado)`);
  const comision = comisionRetiro(monto, cfg);
  const neto = monto - comision;
  const id = nuevoId('ret');
  const manual = monto >= cfg.retiro.revisionManualDesde;
  estado.retiros[id] = {
    id, usuarioId, monto, comision, neto, clabe: String(clabe).replace(/\s/g, ''),
    estado: 'en_revision', revisionManual: manual, creado: new Date().toISOString(),
  };
  asentar(estado, 'retiro_solicitado', [
    { cuenta: `u:${usuarioId}`, monto: -monto },
    { cuenta: 'retiros', monto: neto },
    { cuenta: 'casa', monto: comision },
  ], { retiroId: id, usuarioId });
  return estado.retiros[id];
}

export function aprobarRetiro(estado, retiroId, actorId, cfg = CONFIG) {
  exigirAdmin(estado, actorId);
  const r = estado.retiros[retiroId] || falla('Retiro no existe');
  if (r.estado !== 'en_revision') falla('El retiro ya se procesó');
  if (actorId && actorId === r.usuarioId) falla('Nadie aprueba su propio retiro');
  asentar(estado, 'retiro_pagado', [
    { cuenta: 'retiros', monto: -r.neto },
    { cuenta: 'externo', monto: r.neto },
    { cuenta: 'casa', monto: -cfg.costoPagoRetiro },
    { cuenta: 'externo', monto: cfg.costoPagoRetiro },
  ], { retiroId, usuarioId: r.usuarioId });
  Object.assign(r, { estado: 'pagado', procesado: new Date().toISOString() });
  registrarBitacora(estado, actorId, 'aprobar_retiro', { retiroId, monto: r.monto });
  return r;
}

export function rechazarRetiro(estado, retiroId, actorId, motivo = '') {
  exigirAdmin(estado, actorId);
  const r = estado.retiros[retiroId] || falla('Retiro no existe');
  if (r.estado !== 'en_revision') falla('El retiro ya se procesó');
  asentar(estado, 'retiro_rechazado', [
    { cuenta: 'retiros', monto: -r.neto },
    { cuenta: 'casa', monto: -r.comision },     // se devuelve también la comisión
    { cuenta: `u:${r.usuarioId}`, monto: r.monto },
  ], { retiroId, usuarioId: r.usuarioId });
  Object.assign(r, { estado: 'rechazado', motivo, procesado: new Date().toISOString() });
  registrarBitacora(estado, actorId, 'rechazar_retiro', { retiroId, motivo });
  return r;
}

// ---------- Eventos ----------

// probabilidades: [p0, p1] del mercado (sin margen), p. ej. de un feed de momios.
export function crearEvento(estado, { titulo, liga, opciones, inicia, probabilidades = null }, actorId = null) {
  exigirAdmin(estado, actorId);
  if (!titulo?.trim()) falla('Falta el título');
  if (!Array.isArray(opciones) || opciones.length !== 2) falla('Un evento 1v1 tiene exactamente 2 opciones');
  if (probabilidades) {
    const [a, b] = probabilidades.map(Number);
    if (!(a > 0 && b > 0)) falla('Probabilidades inválidas');
    probabilidades = [a / (a + b), b / (a + b)]; // normaliza (quita el margen de la casa de referencia)
  }
  const id = nuevoId('evt');
  estado.eventos[id] = { id, titulo: titulo.trim(), liga: liga || 'Otro', opciones, inicia, probabilidades, estado: 'abierto', resultado: null };
  return estado.eventos[id];
}

export function cerrarEvento(estado, eventoId, actorId = null) {
  exigirAdmin(estado, actorId);
  const ev = estado.eventos[eventoId] || falla('Evento no existe');
  if (ev.estado !== 'abierto') falla('El evento no está abierto');
  ev.estado = 'cerrado';
  registrarBitacora(estado, actorId, 'cerrar_evento', { eventoId });
  return ev;
}

// ---------- Momios y estadísticas ----------

export const comisionDe = (ganancia, cfg = CONFIG) => Math.round(ganancia * cfg.tasaComision);
// Lo que recibe alguien que arriesga `mio` contra `suyo` si gana (incluye su dinero de vuelta).
export const pagoSiGana = (mio, suyo, cfg = CONFIG) => mio + suyo - comisionDe(suyo, cfg);
// Probabilidad mínima a la que conviene arriesgar `mio` para ganar `suyo` (ya con comisión).
export const probEquilibrio = (mio, suyo, cfg = CONFIG) => mio / (mio + suyo - comisionDe(suyo, cfg));
// Monto que tendría que poner el rival para que sea justo, dada la probabilidad p de MI lado.
export const montoJusto = (mio, p) => Math.max(1, Math.round((mio * (1 - p)) / p));
// Valor esperado por cada peso arriesgado (0.10 = gano 10 centavos por peso en promedio).
export const valorEsperado = (mio, suyo, p, cfg = CONFIG) => (p * (suyo - comisionDe(suyo, cfg)) - (1 - p) * mio) / mio;

export function analizarApuesta({ mio, suyo, p }, cfg = CONFIG) {
  const ev = p == null ? null : valorEsperado(mio, suyo, p, cfg);
  return {
    multiplicador: pagoSiGana(mio, suyo, cfg) / mio,
    probEquilibrio: probEquilibrio(mio, suyo, cfg),
    probMercado: p,
    valorEsperado: ev,
    veredicto: ev == null ? 'sin_datos' : ev > 0.05 ? 'ventaja' : ev < -0.05 ? 'desventaja' : 'justo',
  };
}

// Estadísticas de un reto desde cada lado.
export function estadisticasReto(estado, r, cfg = CONFIG) {
  const p = estado.eventos[r.eventoId]?.probabilidades;
  return {
    creador: analizarApuesta({ mio: r.monto, suyo: r.montoRival, p: p ? p[r.lado] : null }, cfg),
    rival: analizarApuesta({ mio: r.montoRival, suyo: r.monto, p: p ? p[1 - r.lado] : null }, cfg),
  };
}

// ---------- Retos 1v1 ----------

// El creador elige un lado y cuánto pone. `montoRival` es lo que debe poner
// quien acepte: igual = parejo; distinto = momio propio (p. ej. 100 vs 50).
export function crearReto(estado, { creadorId, eventoId, lado, monto, montoRival = monto, privado = false }, cfg = CONFIG) {
  exigirActivo(estado, creadorId);
  const ev = estado.eventos[eventoId] || falla('Evento no existe');
  if (ev.estado !== 'abierto') falla('El evento ya no acepta retos');
  if (ev.inicia && new Date(ev.inicia) <= new Date()) falla('El evento ya empezó');
  if (lado !== 0 && lado !== 1) falla('Lado inválido');
  for (const m of [monto, montoRival]) {
    if (!Number.isInteger(m)) falla('Monto inválido');
    if (m < cfg.apuestaMinima) falla(`La apuesta mínima es ${fmt(cfg.apuestaMinima)}`);
    if (m > cfg.apuestaMaxima) falla(`La apuesta máxima es ${fmt(cfg.apuestaMaxima)}`);
  }
  if (Math.max(monto, montoRival) / Math.min(monto, montoRival) > cfg.ratioMaximo) falla(`El momio máximo es ${cfg.ratioMaximo} a 1`);
  if (saldoUsuario(estado, creadorId) < monto) falla('Saldo insuficiente');
  const id = nuevoId('rto');
  estado.retos[id] = {
    id, eventoId, creadorId, lado, monto, montoRival, privado,
    rivalId: null, estado: 'abierto', ganadorId: null, comision: 0,
    creado: new Date().toISOString(), aceptado: null,
  };
  asentar(estado, 'bloqueo', [
    { cuenta: `u:${creadorId}`, monto: -monto },
    { cuenta: 'escrow', monto },
  ], { retoId: id });
  return estado.retos[id];
}

export function aceptarReto(estado, retoId, rivalId) {
  exigirActivo(estado, rivalId);
  const r = estado.retos[retoId] || falla('Reto no existe');
  if (r.estado !== 'abierto') falla('Este reto ya no está disponible');
  if (r.creadorId === rivalId) falla('No puedes aceptar tu propio reto');
  const ev = estado.eventos[r.eventoId];
  if (ev.estado !== 'abierto' || (ev.inicia && new Date(ev.inicia) <= new Date())) falla('El evento ya empezó');
  if (saldoUsuario(estado, rivalId) < r.montoRival) falla('Saldo insuficiente');
  asentar(estado, 'bloqueo', [
    { cuenta: `u:${rivalId}`, monto: -r.montoRival },
    { cuenta: 'escrow', monto: r.montoRival },
  ], { retoId });
  Object.assign(r, { rivalId, estado: 'emparejado', aceptado: new Date().toISOString() });
  return r;
}

export function cancelarReto(estado, retoId, usuarioId) {
  const r = estado.retos[retoId] || falla('Reto no existe');
  if (r.creadorId !== usuarioId) falla('Solo quien creó el reto puede cancelarlo');
  if (r.estado !== 'abierto') falla('Un reto aceptado es un compromiso: ya no se puede cancelar');
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

// resultado: 0 | 1 (índice de la opción ganadora) o 'anulado' (empate,
// suspendido, etc.) → se devuelve todo sin comisión.
export function resolverEvento(estado, eventoId, resultado, actorId = null, cfg = CONFIG) {
  exigirAdmin(estado, actorId);
  const ev = estado.eventos[eventoId] || falla('Evento no existe');
  if (ev.estado === 'resuelto' || ev.estado === 'anulado') falla('El evento ya se resolvió');
  if (![0, 1, 'anulado'].includes(resultado)) falla('Resultado inválido');
  const resumen = { liquidados: 0, reembolsados: 0, comisionTotal: 0 };

  for (const r of Object.values(estado.retos)) {
    if (r.eventoId !== eventoId) continue;
    if (r.estado === 'abierto') { reembolsar(estado, r, 'expirado'); resumen.reembolsados++; continue; }
    if (r.estado !== 'emparejado') continue;
    if (resultado === 'anulado') { reembolsar(estado, r, 'anulado'); resumen.reembolsados++; continue; }

    const ganaCreador = resultado === r.lado;
    const ganadorId = ganaCreador ? r.creadorId : r.rivalId;
    const ganancia = ganaCreador ? r.montoRival : r.monto; // lo que puso el que perdió
    const comision = comisionDe(ganancia, cfg);
    const bote = r.monto + r.montoRival;
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
  registrarBitacora(estado, actorId, 'resolver_evento', { eventoId, resultado, ...resumen });
  return resumen;
}

// ---------- Antifraude ----------
// Señales para revisión humana; no bloquean solas (evita falsos positivos).

export function alertasFraude(estado, cfg = CONFIG) {
  const alertas = [];
  const emparejados = Object.values(estado.retos).filter((r) => r.rivalId);
  const nombre = (id) => estado.usuarios[id]?.nombre || id;

  // 1. Momio absurdo contra el mercado: forma típica de pasar dinero entre cuentas.
  for (const r of emparejados) {
    const st = estadisticasReto(estado, r, cfg);
    const peor = Math.min(st.creador.valorEsperado ?? 0, st.rival.valorEsperado ?? 0);
    if (peor < -0.5 && r.monto + r.montoRival >= 20000) {
      const perdedor = st.creador.valorEsperado < st.rival.valorEsperado ? r.creadorId : r.rivalId;
      alertas.push({ tipo: 'momio_extremo', nivel: 'alta', retoId: r.id, usuarios: [r.creadorId, r.rivalId],
        texto: `${nombre(perdedor)} aceptó un momio ${Math.round(-peor * 100)}% peor que el mercado` });
    }
  }

  // 2. Parejas que siempre juegan entre sí y el dinero fluye en un solo sentido.
  const parejas = {};
  for (const r of emparejados.filter((x) => x.estado === 'liquidado')) {
    const [a, b] = [r.creadorId, r.rivalId].sort();
    const p = (parejas[`${a}|${b}`] ||= { a, b, n: 0, flujo: 0, volumen: 0 });
    const perdedorPuso = r.ganadorId === r.creadorId ? r.montoRival : r.monto;
    p.n++; p.volumen += perdedorPuso;
    p.flujo += r.ganadorId === a ? perdedorPuso : -perdedorPuso;
  }
  for (const p of Object.values(parejas)) {
    if (p.n >= 3 && p.volumen >= 100000 && Math.abs(p.flujo) / p.volumen >= 0.8) {
      const gana = p.flujo > 0 ? p.a : p.b;
      alertas.push({ tipo: 'pareja_recurrente', nivel: 'alta', usuarios: [p.a, p.b],
        texto: `${nombre(p.a)} y ${nombre(p.b)}: ${p.n} retos entre sí, ${nombre(gana)} ganó ${Math.round(Math.abs(p.flujo) / p.volumen * 100)}% del dinero` });
    }
  }

  // 3. Retiros grandes o de cuentas recién creadas.
  for (const r of Object.values(estado.retiros).filter((x) => x.estado === 'en_revision')) {
    const u = estado.usuarios[r.usuarioId];
    if (r.revisionManual) alertas.push({ tipo: 'retiro_grande', nivel: 'media', retiroId: r.id, usuarios: [r.usuarioId], texto: `Retiro de ${fmt(r.monto)} requiere revisión manual` });
    if (u && Date.now() - new Date(u.creado).getTime() < 864e5) alertas.push({ tipo: 'cuenta_nueva', nivel: 'media', retiroId: r.id, usuarios: [r.usuarioId], texto: `${nombre(r.usuarioId)} pide retiro con menos de 24 h de antigüedad` });
  }

  // 4. Depósitos repetidos con el mismo id de proveedor (no debería pasar nunca).
  const vistos = {};
  for (const d of Object.values(estado.depositos)) {
    if (!d.idProveedor) continue;
    if (vistos[d.idProveedor]) alertas.push({ tipo: 'deposito_duplicado', nivel: 'alta', usuarios: [d.usuarioId], texto: `Pago ${d.idProveedor} aparece en dos depósitos` });
    vistos[d.idProveedor] = true;
  }
  return alertas;
}

// ---------- Utilidades ----------

export const aCentavos = (pesos) => Math.round(Number(pesos) * 100);
export const fmt = (centavos) =>
  (centavos / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });

export function metricasCasa(estado) {
  const retos = Object.values(estado.retos);
  const emparejados = retos.filter((r) => r.rivalId);
  const porTipo = (tipo) => estado.asientos.filter((a) => a.tipo === tipo)
    .reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'casa').reduce((x, l) => x + l.monto, 0), 0);
  return {
    usuarios: Object.keys(estado.usuarios).length,
    retosCreados: retos.length,
    retosEmparejados: emparejados.length,
    tasaEmparejamiento: retos.length ? emparejados.length / retos.length : 0,
    volumen: emparejados.reduce((s, r) => s + r.monto + r.montoRival, 0),
    enEscrow: saldo(estado, 'escrow'),
    retirosEnRevision: saldo(estado, 'retiros'),
    comisionApuestas: porTipo('liquidacion'),
    comisionRetiros: porTipo('retiro_solicitado') + porTipo('retiro_rechazado'),
    costosPago: porTipo('deposito') + porTipo('retiro_pagado'),
    resultadoCasa: saldo(estado, 'casa'),
    cuadra: verificarCuadre(estado),
  };
}
