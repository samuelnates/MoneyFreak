import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../web/js/motor.js';

function escenario() {
  const e = M.crearEstado();
  const ana = M.registrarUsuario(e, { nombre: 'Ana' });
  const beto = M.registrarUsuario(e, { nombre: 'Beto' });
  const ev = M.crearEvento(e, { titulo: 'América vs Chivas', liga: 'Liga MX', opciones: ['América', 'Chivas'] });
  return { e, ana, beto, ev };
}

test('bono de bienvenida y cuadre inicial', () => {
  const { e, ana } = escenario();
  assert.equal(M.saldoUsuario(e, ana.id), M.CONFIG.bonoBienvenida);
  assert.ok(M.verificarCuadre(e));
});

test('flujo completo: crear, aceptar, liquidar con 5% de comisión', () => {
  const { e, ana, beto, ev } = escenario();
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 20000 });
  assert.equal(M.saldo(e, 'escrow'), 20000);
  M.aceptarReto(e, r.id, beto.id);
  assert.equal(M.saldo(e, 'escrow'), 40000);
  const res = M.resolverEvento(e, ev.id, 0);
  assert.equal(res.comisionTotal, 2000);
  assert.equal(M.saldoUsuario(e, ana.id), 100000 - 20000 + 38000);
  assert.equal(M.saldoUsuario(e, beto.id), 100000 - 20000);
  assert.equal(M.saldo(e, 'casa'), 2000);
  assert.equal(M.saldo(e, 'escrow'), 0);
  assert.ok(M.verificarCuadre(e));
});

test('gana el rival y momio desigual', () => {
  const { e, ana, beto, ev } = escenario();
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 30000, montoRival: 10000 });
  M.aceptarReto(e, r.id, beto.id);
  M.resolverEvento(e, ev.id, 1);
  assert.equal(r.ganadorId, beto.id);
  assert.equal(M.saldoUsuario(e, beto.id), 100000 - 10000 + 38000);
});

test('anulado devuelve todo sin comisión; retos sin rival se reembolsan', () => {
  const { e, ana, beto, ev } = escenario();
  const r1 = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 10000 });
  M.crearReto(e, { creadorId: beto.id, eventoId: ev.id, lado: 1, monto: 5000 });
  M.aceptarReto(e, r1.id, beto.id);
  M.resolverEvento(e, ev.id, 'anulado');
  assert.equal(M.saldoUsuario(e, ana.id), 100000);
  assert.equal(M.saldoUsuario(e, beto.id), 100000);
  assert.equal(M.saldo(e, 'casa'), 0);
  assert.ok(M.verificarCuadre(e));
});

test('reglas: saldo, propio reto, doble aceptación, límites, evento cerrado', () => {
  const { e, ana, beto, ev } = escenario();
  assert.throws(() => M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 200000 }), /máxima|insuficiente/);
  assert.throws(() => M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 500 }), /mínima/);
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 10000 });
  assert.throws(() => M.aceptarReto(e, r.id, ana.id), /propio/);
  M.aceptarReto(e, r.id, beto.id);
  const carlos = M.registrarUsuario(e, { nombre: 'Carlos' });
  assert.throws(() => M.aceptarReto(e, r.id, carlos.id), /disponible/);
  assert.throws(() => M.cancelarReto(e, r.id, ana.id), /nadie ha aceptado/);
  M.cerrarEvento(e, ev.id);
  assert.throws(() => M.crearReto(e, { creadorId: carlos.id, eventoId: ev.id, lado: 1, monto: 10000 }), /no acepta/);
  M.resolverEvento(e, ev.id, 1);
  assert.throws(() => M.resolverEvento(e, ev.id, 0), /ya se resolvió/);
});

test('cancelar reto abierto devuelve el dinero', () => {
  const { e, ana, ev } = escenario();
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 1, monto: 15000 });
  M.cancelarReto(e, r.id, ana.id);
  assert.equal(M.saldoUsuario(e, ana.id), 100000);
  assert.equal(r.estado, 'cancelado');
});

test('fuzz: 500 operaciones aleatorias nunca descuadran ni dejan saldos negativos', () => {
  const e = M.crearEstado();
  const us = Array.from({ length: 6 }, (_, i) => M.registrarUsuario(e, { nombre: `U${i}` }));
  const evs = Array.from({ length: 4 }, (_, i) => M.crearEvento(e, { titulo: `E${i}`, opciones: ['A', 'B'] }));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  for (let i = 0; i < 500; i++) {
    try {
      const op = Math.random();
      if (op < 0.5) M.crearReto(e, { creadorId: pick(us).id, eventoId: pick(evs).id, lado: Math.random() < 0.5 ? 0 : 1, monto: 1000 * (1 + Math.floor(Math.random() * 30)) });
      else if (op < 0.85) { const r = pick(Object.values(e.retos)); if (r) M.aceptarReto(e, r.id, pick(us).id); }
      else if (op < 0.95) { const r = pick(Object.values(e.retos)); if (r) M.cancelarReto(e, r.id, r.creadorId); }
      else M.resolverEvento(e, pick(evs).id, pick([0, 1, 'anulado']));
    } catch (err) { if (!(err instanceof M.ErrorMotor)) throw err; }
    assert.ok(M.verificarCuadre(e));
    for (const u of us) assert.ok(M.saldoUsuario(e, u.id) >= 0);
  }
});
