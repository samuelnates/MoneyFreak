import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../web/js/motor.js';

const CLABE_OK = '002010077777777771'; // CLABE de ejemplo con dígito verificador válido

function escenario() {
  const e = M.crearEstado();
  const ana = M.registrarUsuario(e, { nombre: 'Ana' });
  const beto = M.registrarUsuario(e, { nombre: 'Beto' });
  const admin = M.registrarUsuario(e, { nombre: 'Admin', esAdmin: true });
  const ev = M.crearEvento(e, { titulo: 'América vs Chivas', liga: 'Liga MX', opciones: ['América', 'Chivas'], probabilidades: [0.6, 0.4] });
  return { e, ana, beto, admin, ev };
}
const depositar = (e, uid, monto, metodo = 'spei') => M.confirmarDeposito(e, M.iniciarDeposito(e, uid, monto, metodo).id, `prov_${Math.random()}`);

test('bono de bienvenida y cuadre inicial', () => {
  const { e, ana } = escenario();
  assert.equal(M.saldoUsuario(e, ana.id), M.CONFIG.bonoBienvenida);
  assert.ok(M.verificarCuadre(e));
});

test('parejo 200 vs 200: comisión 5% sobre la ganancia (no sobre el bote)', () => {
  const { e, ana, beto, ev } = escenario();
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 20000 });
  M.aceptarReto(e, r.id, beto.id);
  const res = M.resolverEvento(e, ev.id, 0);
  assert.equal(res.comisionTotal, 1000);                          // 5% de $200
  assert.equal(M.saldoUsuario(e, ana.id), 100000 - 20000 + 39000); // recibe $390
  assert.equal(M.saldoUsuario(e, beto.id), 80000);
  assert.equal(M.saldo(e, 'escrow'), 0);
  assert.ok(M.verificarCuadre(e));
});

test('momio desigual 100 vs 50: cada lado paga comisión solo sobre lo que gana', () => {
  const { e, ana, beto, ev } = escenario();
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 10000, montoRival: 5000 });
  M.aceptarReto(e, r.id, beto.id);
  M.resolverEvento(e, ev.id, 0); // gana Ana: gana $50, comisión $2.50
  assert.equal(r.comision, 250);
  assert.equal(M.saldoUsuario(e, ana.id), 100000 - 10000 + 14750);
  // si hubiera ganado Beto: gana $100, comisión $5
  assert.equal(M.pagoSiGana(5000, 10000), 14500);
});

test('estadísticas: momio justo, probabilidad de equilibrio y veredicto', () => {
  const { e, ana, ev } = escenario();
  assert.equal(M.montoJusto(10000, 0.6), 6667); // a 60%, por $100 el rival justo pone $66.67
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 10000, montoRival: 5000 });
  const st = M.estadisticasReto(e, r);
  // Ana arriesga 100 para ganar 50 en algo de 60% → mal negocio para Ana, bueno para el rival
  assert.equal(st.creador.veredicto, 'desventaja');
  assert.equal(st.rival.veredicto, 'ventaja');
  assert.ok(Math.abs(st.rival.multiplicador - 2.9) < 1e-9); // pone 50, recibe 50+100−5 = 145
  assert.ok(st.creador.probEquilibrio > 0.67);
});

test('compromiso: un reto aceptado no se cancela', () => {
  const { e, ana, beto, ev } = escenario();
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 1, monto: 15000 });
  M.aceptarReto(e, r.id, beto.id);
  assert.throws(() => M.cancelarReto(e, r.id, ana.id), /compromiso/);
});

test('reglas: saldo, propio reto, doble aceptación, límites, momio máximo, evento cerrado, permisos', () => {
  const { e, ana, beto, admin, ev } = escenario();
  assert.throws(() => M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 200000 }), /insuficiente/);
  assert.throws(() => M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 500 }), /mínima/);
  assert.throws(() => M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 50000, montoRival: 1000 }), /momio máximo/);
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 10000 });
  assert.throws(() => M.aceptarReto(e, r.id, ana.id), /propio/);
  M.aceptarReto(e, r.id, beto.id);
  assert.throws(() => M.aceptarReto(e, r.id, admin.id), /disponible/);
  assert.throws(() => M.resolverEvento(e, ev.id, 0, ana.id), /administradores/);
  M.cerrarEvento(e, ev.id, admin.id);
  assert.throws(() => M.crearReto(e, { creadorId: beto.id, eventoId: ev.id, lado: 1, monto: 10000 }), /no acepta/);
  M.resolverEvento(e, ev.id, 1, admin.id);
  assert.throws(() => M.resolverEvento(e, ev.id, 0, admin.id), /ya se resolvió/);
  assert.equal(e.bitacora.filter((b) => b.actorId === admin.id).length, 2);
});

test('evento que ya empezó no acepta retos', () => {
  const { e, ana } = escenario();
  const ev = M.crearEvento(e, { titulo: 'X', opciones: ['A', 'B'], inicia: new Date(Date.now() - 1000).toISOString() });
  assert.throws(() => M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 10000 }), /empezó/);
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
});

test('depósitos: OXXO queda pendiente hasta el webhook, idempotente, límites y costos a cargo de la casa', () => {
  const { e, ana } = escenario();
  const d = M.iniciarDeposito(e, ana.id, 50000, 'oxxo');
  assert.equal(d.referencia.length, 14);
  assert.equal(M.saldoUsuario(e, ana.id), 100000); // aún no llega
  M.confirmarDeposito(e, d.id, 'oxxo_123');
  M.confirmarDeposito(e, d.id, 'oxxo_123');      // webhook repetido
  assert.equal(M.saldoUsuario(e, ana.id), 150000); // se acreditó una sola vez
  assert.equal(M.saldo(e, 'casa'), -M.costoDeposito('oxxo', 50000));
  const d2 = M.iniciarDeposito(e, ana.id, 50000, 'tarjeta');
  assert.throws(() => M.confirmarDeposito(e, d2.id, 'oxxo_123'), /ya se usó/);
  assert.throws(() => M.iniciarDeposito(e, ana.id, 2000000, 'oxxo'), /máximo/);
  assert.throws(() => M.iniciarDeposito(e, ana.id, 1000, 'spei'), /mínimo/);
  assert.throws(() => M.iniciarDeposito(e, ana.id, 1950000, 'spei'), /Límite diario/);
  assert.ok(M.verificarCuadre(e));
});

test('CLABE: dígito verificador', () => {
  assert.ok(M.validarClabe(CLABE_OK));
  assert.ok(!M.validarClabe('002010077777777772'));
  assert.ok(!M.validarClabe('12345'));
});

test('retiros: rollover antilavado, comisión 2% mín $15, revisión y rechazo devuelve todo', () => {
  const { e, ana, beto, admin, ev } = escenario();
  assert.throws(() => M.solicitarRetiro(e, ana.id, 20000, CLABE_OK), /antilavado/);
  const r = M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 100000 });
  M.aceptarReto(e, r.id, beto.id);
  M.resolverEvento(e, ev.id, 0); // Ana apostó 1,000 ≥ fondeado → ya puede retirar; tiene 1,950
  assert.throws(() => M.solicitarRetiro(e, ana.id, 20000, '123'), /CLABE/);
  assert.throws(() => M.solicitarRetiro(e, ana.id, 5000, CLABE_OK), /mínimo/);
  const ret = M.solicitarRetiro(e, ana.id, 50000, CLABE_OK);
  assert.equal(ret.comision, 1500);  // 2% de 500 = 10 → aplica mínimo de 15
  assert.equal(ret.neto, 48500);
  assert.equal(M.comisionRetiro(200000), 4000);
  assert.throws(() => M.aprobarRetiro(e, ret.id, ana.id), /administradores/);
  M.aprobarRetiro(e, ret.id, admin.id);
  assert.throws(() => M.aprobarRetiro(e, ret.id, admin.id), /ya se procesó/);
  const ret2 = M.solicitarRetiro(e, ana.id, 20000, CLABE_OK);
  const antes = M.saldoUsuario(e, ana.id);
  M.rechazarRetiro(e, ret2.id, admin.id, 'Titular no coincide');
  assert.equal(M.saldoUsuario(e, ana.id), antes + 20000);
  assert.equal(M.saldo(e, 'retiros'), 0);
  assert.ok(M.verificarCuadre(e));
});

test('antifraude: momio extremo y pareja que se pasa dinero', () => {
  const { e, ana, beto } = escenario();
  // Beto pone 10 a 1 sobre el lado de 40%: pierde valor a propósito para pasarle dinero a Ana (chip dumping)
  depositar(e, beto.id, 50000);
  const evs = [1, 2, 3, 4].map((i) => M.crearEvento(e, { titulo: `E${i}`, opciones: ['A', 'B'], probabilidades: [0.4, 0.6] }));
  for (const x of evs) {
    const r = M.crearReto(e, { creadorId: ana.id, eventoId: x.id, lado: 1, monto: 3000, montoRival: 30000 });
    M.aceptarReto(e, r.id, beto.id);
    M.resolverEvento(e, x.id, 1);
  }
  const tipos = M.alertasFraude(e).map((a) => a.tipo);
  assert.ok(tipos.includes('momio_extremo'));
  assert.ok(tipos.includes('pareja_recurrente'));
});

test('autoexclusión bloquea apostar y depositar', () => {
  const { e, ana, ev } = escenario();
  M.autoexcluir(e, ana.id, 7);
  assert.throws(() => M.crearReto(e, { creadorId: ana.id, eventoId: ev.id, lado: 0, monto: 10000 }), /autoexclusión/);
  assert.throws(() => M.iniciarDeposito(e, ana.id, 10000, 'spei'), /autoexclusión/);
});

test('fuzz: 1,000 operaciones aleatorias nunca descuadran ni dejan saldos negativos', () => {
  const e = M.crearEstado();
  const admin = M.registrarUsuario(e, { nombre: 'Admin', esAdmin: true });
  const us = Array.from({ length: 6 }, (_, i) => M.registrarUsuario(e, { nombre: `U${i}` }));
  const evs = Array.from({ length: 5 }, (_, i) => M.crearEvento(e, { titulo: `E${i}`, opciones: ['A', 'B'], probabilidades: [0.5, 0.5] }));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  for (let i = 0; i < 1000; i++) {
    try {
      const op = Math.random();
      const u = pick(us).id;
      if (op < 0.35) M.crearReto(e, { creadorId: u, eventoId: pick(evs).id, lado: Math.random() < 0.5 ? 0 : 1, monto: 1000 * (1 + Math.floor(Math.random() * 30)), montoRival: 1000 * (1 + Math.floor(Math.random() * 30)) });
      else if (op < 0.6) { const r = pick(Object.values(e.retos)); if (r) M.aceptarReto(e, r.id, u); }
      else if (op < 0.65) { const r = pick(Object.values(e.retos)); if (r) M.cancelarReto(e, r.id, r.creadorId); }
      else if (op < 0.7) M.resolverEvento(e, pick(evs).id, pick([0, 1, 'anulado']), admin.id);
      else if (op < 0.8) depositar(e, u, 5000 * (1 + Math.floor(Math.random() * 10)), pick(['spei', 'tarjeta', 'oxxo']));
      else if (op < 0.9) M.solicitarRetiro(e, u, 10000 * (1 + Math.floor(Math.random() * 5)), CLABE_OK);
      else { const r = pick(Object.values(e.retiros)); if (r) (Math.random() < 0.7 ? M.aprobarRetiro : M.rechazarRetiro)(e, r.id, admin.id); }
    } catch (err) { if (!(err instanceof M.ErrorMotor)) throw err; }
    assert.ok(M.verificarCuadre(e));
    for (const u of us) assert.ok(M.saldoUsuario(e, u.id) >= 0);
    assert.ok(M.saldo(e, 'escrow') >= 0 && M.saldo(e, 'retiros') >= 0);
  }
});
