import * as M from './motor.js';
import * as A from './almacen.js';
import { MARCA } from './config.js';

let estado = A.cargar();
let yoId = A.sesion.get();
if (yoId && !estado.usuarios[yoId]) yoId = null;

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yo = () => estado.usuarios[yoId];
const persistir = () => A.guardar(estado);
const ir = (ruta) => { location.hash = ruta; };

document.title = `${MARCA.nombre} · Apuestas 1 vs 1`;

// ---------- Toast ----------
function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('fuera'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// Diálogo propio (confirm/prompt nativos no funcionan en todos los contenedores
// y se ven fuera de marca). Devuelve una Promise: true/false o el texto.
function preguntar(mensaje, { ok = 'Confirmar', peligro = false, campo = null } = {}) {
  return new Promise((resolver) => {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `<div class="modal tarjeta" role="dialog" aria-modal="true">
      <p>${esc(mensaje)}</p>
      ${campo !== null ? `<label class="campo-monto">$<input id="modal-campo" type="number" inputmode="decimal" value="${esc(campo)}"></label>` : ''}
      <div class="fila-btn">
        <button class="btn btn-secundario" data-r="no">Volver</button>
        <button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-r="si">${esc(ok)}</button>
      </div></div>`;
    const cerrar = (v) => { fondo.remove(); resolver(v); };
    fondo.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (r === 'si') cerrar(campo !== null ? fondo.querySelector('#modal-campo').value : true);
      else if (r === 'no' || e.target === fondo) cerrar(campo !== null ? null : false);
    });
    document.body.appendChild(fondo);
    (fondo.querySelector('#modal-campo') || fondo.querySelector('[data-r="si"]')).focus();
  });
}

// Ejecuta una operación del motor; si falla muestra el motivo.
function operar(fn, msgOk) {
  try {
    const r = fn();
    persistir();
    if (msgOk) toast(msgOk);
    return r ?? true;
  } catch (e) {
    if (e instanceof M.ErrorMotor) { toast(e.message, 'error'); return null; }
    throw e;
  }
}

// ---------- Piezas de UI ----------
const fechaCorta = (iso) => iso ? new Date(iso).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const ETIQUETA_ESTADO = {
  abierto: ['Esperando rival', 'pend'], emparejado: ['En juego', 'vivo'], liquidado: ['Liquidado', 'fin'],
  cancelado: ['Cancelado', 'gris'], expirado: ['Sin rival · reembolsado', 'gris'], anulado: ['Anulado · reembolsado', 'gris'],
};

function encabezado(titulo, atras) {
  return `
  <header class="barra">
    ${atras ? `<button class="btn-icono" data-accion="atras" aria-label="Atrás">‹</button>` : `<span class="logo">${esc(MARCA.nombre)}</span>`}
    ${titulo ? `<h1 class="barra-titulo">${esc(titulo)}</h1>` : '<span></span>'}
    <a class="chip-saldo" href="#/billetera" aria-label="Saldo">${M.fmt(M.saldoUsuario(estado, yoId))}</a>
  </header>
  ${MARCA.modoDinero === 'demo' ? `<div class="aviso-demo">Modo demo · fichas sin valor real</div>` : ''}`;
}

function navInferior(activo) {
  const items = [['inicio', '⌂', 'Inicio'], ['mis-retos', '⚔', 'Mis retos'], ['crear', '+', 'Retar'], ['billetera', '◎', 'Billetera'], ['perfil', '☺', 'Perfil']];
  return `<nav class="nav-inf">${items.map(([r, i, t]) =>
    `<a href="#/${r}" class="${r === 'crear' ? 'nav-crear' : ''} ${activo === r ? 'activo' : ''}"><span class="nav-ico">${i}</span><span>${t}</span></a>`).join('')}</nav>`;
}

function tarjetaReto(r, { mostrarEvento = true } = {}) {
  const ev = estado.eventos[r.eventoId];
  const creador = estado.usuarios[r.creadorId];
  const soyCreador = r.creadorId === yoId;
  const soyParte = soyCreador || r.rivalId === yoId;
  const miLado = soyCreador ? r.lado : (r.rivalId === yoId ? 1 - r.lado : null);
  const [etq, cls] = ETIQUETA_ESTADO[r.estado];
  let resultado = '';
  if (r.estado === 'liquidado' && soyParte) {
    const gane = r.ganadorId === yoId;
    resultado = `<span class="res ${gane ? 'res-gane' : 'res-perdi'}">${gane ? `Ganaste ${M.fmt(r.monto + r.montoRival - r.comision)}` : 'Perdiste'}</span>`;
  }
  const lado = soyParte ? miLado : 1 - r.lado; // si no soy parte, muestro el lado que me tocaría
  const pongo = soyParte ? (soyCreador ? r.monto : r.montoRival) : r.montoRival;
  return `
  <a class="tarjeta reto" href="#/reto/${r.id}">
    ${mostrarEvento ? `<div class="reto-evento"><span class="liga">${esc(ev.liga)}</span> ${esc(ev.titulo)}</div>` : ''}
    <div class="reto-cuerpo">
      <div>
        <div class="reto-quien">${soyCreador ? 'Tu reto' : `Reto de <b>${esc(creador.nombre)}</b>`}</div>
        <div class="reto-lado">${soyParte ? 'Vas con' : 'Te toca'} <b>${esc(ev.opciones[lado])}</b></div>
      </div>
      <div class="reto-montos">
        <div class="monto-grande">${M.fmt(pongo)}</div>
        <div class="sub">bote ${M.fmt(r.monto + r.montoRival)}</div>
      </div>
    </div>
    <div class="reto-pie"><span class="pill pill-${cls}">${etq}</span>${resultado}${r.privado ? '<span class="pill pill-gris">Privado</span>' : ''}</div>
  </a>`;
}

// ---------- Pantallas ----------
const vistas = {};

vistas.bienvenida = () => `
  <main class="bienvenida">
    <div class="hero">
      <div class="logo-grande">${esc(MARCA.nombre)}</div>
      <p class="lema">${esc(MARCA.lema)}</p>
      <ul class="como">
        <li><b>1.</b> Elige un partido y tu lado.</li>
        <li><b>2.</b> Reta a un amigo o publica tu reto.</li>
        <li><b>3.</b> El dinero queda en custodia. Gana el que acierta.</li>
      </ul>
    </div>
    <form class="tarjeta form" data-form="registro">
      <label>¿Cómo te llamas?<input name="nombre" required maxlength="30" autocomplete="nickname" placeholder="Tu apodo"></label>
      <label>Correo<input name="email" type="email" autocomplete="email" placeholder="tu@correo.com"></label>
      <label class="check"><input type="checkbox" name="edad" required> Tengo ${MARCA.edadMinima} años o más y acepto los términos.</label>
      <button class="btn btn-primario" type="submit">Entrar con ${M.fmt(M.CONFIG.bonoBienvenida)} en fichas demo</button>
      ${usuariosReales().length ? `<button class="btn btn-fantasma" type="button" data-accion="elegir-cuenta">Ya tengo cuenta en este dispositivo</button>` : ''}
    </form>
  </main>`;

vistas.inicio = () => {
  const abiertos = Object.values(estado.retos).filter((r) => r.estado === 'abierto' && !r.privado && r.creadorId !== yoId);
  const eventos = Object.values(estado.eventos).filter((e) => e.estado === 'abierto');
  return `${encabezado()}
  <main>
    <section>
      <h2 class="sec-titulo">Retos esperando rival <span class="contador">${abiertos.length}</span></h2>
      ${abiertos.length ? `<div class="carrusel">${abiertos.map((r) => tarjetaReto(r)).join('')}</div>` : `<p class="vacio">Nadie ha publicado retos. ¡Sé el primero!</p>`}
    </section>
    <section>
      <h2 class="sec-titulo">Próximos eventos</h2>
      ${eventos.map((e) => {
        const n = Object.values(estado.retos).filter((r) => r.eventoId === e.id && r.estado === 'abierto').length;
        return `<a class="tarjeta evento" href="#/evento/${e.id}">
          <div><span class="liga">${esc(e.liga)}</span><div class="evento-titulo">${esc(e.titulo)}</div><div class="sub">${fechaCorta(e.inicia)}</div></div>
          <div class="evento-der">${n ? `<span class="pill pill-pend">${n} ${n === 1 ? "abierto" : "abiertos"}</span>` : ''}<span class="btn btn-chico">Retar</span></div>
        </a>`;
      }).join('') || '<p class="vacio">No hay eventos abiertos.</p>'}
    </section>
  </main>${navInferior('inicio')}`;
};

vistas.evento = (id) => {
  const e = estado.eventos[id];
  if (!e) return vistas.noEncontrado();
  const retos = Object.values(estado.retos).filter((r) => r.eventoId === id && r.estado === 'abierto' && !r.privado);
  return `${encabezado(e.liga, true)}
  <main>
    <div class="tarjeta evento-hero">
      <div class="sub">${fechaCorta(e.inicia)}</div>
      <div class="versus"><div>${esc(e.opciones[0])}</div><span>vs</span><div>${esc(e.opciones[1])}</div></div>
      ${e.estado === 'abierto' ? `<a class="btn btn-primario" href="#/crear/${id}">Crear reto</a>` : `<p class="vacio">Este evento ya no acepta retos.</p>`}
    </div>
    <h2 class="sec-titulo">Retos abiertos <span class="contador">${retos.length}</span></h2>
    ${retos.map((r) => tarjetaReto(r, { mostrarEvento: false })).join('') || '<p class="vacio">Sin retos abiertos en este evento.</p>'}
  </main>${navInferior('inicio')}`;
};

// Estado del formulario de "crear reto" (se conserva al re-renderizar).
let borrador = null;
vistas.crear = (eventoId) => {
  const abiertos = Object.values(estado.eventos).filter((e) => e.estado === 'abierto');
  if (!eventoId) {
    return `${encabezado('Nuevo reto')}
    <main><h2 class="sec-titulo">¿Sobre qué quieres apostar?</h2>
      ${abiertos.map((e) => `<a class="tarjeta evento" href="#/crear/${e.id}"><div><span class="liga">${esc(e.liga)}</span><div class="evento-titulo">${esc(e.titulo)}</div><div class="sub">${fechaCorta(e.inicia)}</div></div><span class="flecha">›</span></a>`).join('')}
    </main>${navInferior('crear')}`;
  }
  const e = estado.eventos[eventoId];
  if (!e || e.estado !== 'abierto') return vistas.noEncontrado();
  if (!borrador || borrador.eventoId !== eventoId) borrador = { eventoId, lado: null, monto: 100, rival: 100, parejo: true, privado: false };
  const b = borrador;
  const bote = M.aCentavos(b.monto) + M.aCentavos(b.parejo ? b.monto : b.rival);
  const com = M.comisionDe(bote);
  return `${encabezado('Nuevo reto', true)}
  <main>
    <div class="paso"><span class="paso-n">1</span> ¿Quién gana? <span class="sub">${esc(e.titulo)}</span></div>
    <div class="lados">${e.opciones.map((o, i) => `<button class="lado ${b.lado === i ? 'sel' : ''}" data-accion="lado" data-v="${i}">${esc(o)}</button>`).join('')}</div>

    <div class="paso"><span class="paso-n">2</span> ¿Cuánto pones?</div>
    <div class="montos">${[50, 100, 200, 500, 1000].map((m) => `<button class="chip ${+b.monto === m ? 'sel' : ''}" data-accion="monto" data-v="${m}">$${m}</button>`).join('')}</div>
    <label class="campo-monto">$<input type="number" inputmode="decimal" min="10" step="10" value="${b.monto}" data-campo="monto"></label>

    <div class="paso"><span class="paso-n">3</span> ¿Cuánto pone tu rival?</div>
    <div class="segmento">
      <button class="${b.parejo ? 'sel' : ''}" data-accion="parejo" data-v="1">Lo mismo (parejo)</button>
      <button class="${!b.parejo ? 'sel' : ''}" data-accion="parejo" data-v="0">Otro monto (momio)</button>
    </div>
    ${!b.parejo ? `<label class="campo-monto">$<input type="number" inputmode="decimal" min="10" step="10" value="${b.rival}" data-campo="rival"></label>` : ''}

    <label class="check fila"><input type="checkbox" data-campo="privado" ${b.privado ? 'checked' : ''}> Reto privado (solo con link)</label>

    <div class="resumen">
      <div><span>Bote total</span><b>${M.fmt(bote)}</b></div>
      <div><span>Comisión (${Math.round(M.CONFIG.tasaComision * 100)}%)</span><b>−${M.fmt(com)}</b></div>
      <div class="total"><span>Si ganas recibes</span><b>${M.fmt(bote - com)}</b></div>
    </div>
    <button class="btn btn-primario" data-accion="publicar" ${b.lado === null ? 'disabled' : ''}>${b.lado === null ? 'Elige un lado' : 'Publicar reto'}</button>
    <p class="legal">El dinero de ambos queda en custodia hasta que termine el evento. Si nadie acepta, se te devuelve completo.</p>
  </main>`;
};

vistas.reto = (id) => {
  const r = estado.retos[id];
  if (!r) return vistas.noEncontrado();
  const e = estado.eventos[r.eventoId];
  const creador = estado.usuarios[r.creadorId];
  const rival = r.rivalId && estado.usuarios[r.rivalId];
  const soyCreador = r.creadorId === yoId;
  const puedoAceptar = r.estado === 'abierto' && !soyCreador && e.estado === 'abierto';
  const bote = r.monto + r.montoRival;
  const com = M.comisionDe(bote);
  const [etq, cls] = ETIQUETA_ESTADO[r.estado];
  return `${encabezado('Reto', true)}
  <main>
    <div class="tarjeta reto-detalle">
      <span class="liga">${esc(e.liga)}</span>
      <h2>${esc(e.titulo)}</h2>
      <div class="sub">${fechaCorta(e.inicia)}</div>
      <div class="cara-a-cara">
        <div class="jugador ${r.ganadorId === r.creadorId ? 'ganador' : ''}">
          <div class="avatar">${esc(creador.nombre[0])}</div><b>${esc(soyCreador ? 'Tú' : creador.nombre)}</b>
          <span>${esc(e.opciones[r.lado])}</span><span class="monto">${M.fmt(r.monto)}</span>
        </div>
        <div class="vs">VS</div>
        <div class="jugador ${rival && r.ganadorId === r.rivalId ? 'ganador' : ''}">
          <div class="avatar ${rival ? '' : 'vacio-av'}">${rival ? esc(rival.nombre[0]) : '?'}</div><b>${rival ? esc(r.rivalId === yoId ? 'Tú' : rival.nombre) : 'Esperando…'}</b>
          <span>${esc(e.opciones[1 - r.lado])}</span><span class="monto">${M.fmt(r.montoRival)}</span>
        </div>
      </div>
      <div class="resumen">
        <div><span>Bote</span><b>${M.fmt(bote)}</b></div>
        <div><span>Comisión</span><b>−${M.fmt(com)}</b></div>
        <div class="total"><span>El ganador recibe</span><b>${M.fmt(bote - com)}</b></div>
      </div>
      <span class="pill pill-${cls}">${etq}</span>
    </div>
    ${puedoAceptar ? `<button class="btn btn-primario" data-accion="aceptar" data-id="${r.id}">Aceptar reto · pongo ${M.fmt(r.montoRival)}</button>` : ''}
    ${r.estado === 'abierto' ? `<button class="btn btn-secundario" data-accion="compartir" data-id="${r.id}">Mandar a un amigo</button>` : ''}
    ${soyCreador && r.estado === 'abierto' ? `<button class="btn btn-fantasma peligro" data-accion="cancelar" data-id="${r.id}">Cancelar y recuperar ${M.fmt(r.monto)}</button>` : ''}
  </main>${navInferior('mis-retos')}`;
};

let pestanaMisRetos = 'activos';
vistas['mis-retos'] = () => {
  const mios = Object.values(estado.retos).filter((r) => r.creadorId === yoId || r.rivalId === yoId).reverse();
  const activos = mios.filter((r) => ['abierto', 'emparejado'].includes(r.estado));
  const hist = mios.filter((r) => !['abierto', 'emparejado'].includes(r.estado));
  const lista = pestanaMisRetos === 'activos' ? activos : hist;
  const ganados = hist.filter((r) => r.ganadorId === yoId).length;
  const jugados = hist.filter((r) => r.estado === 'liquidado').length;
  return `${encabezado('Mis retos')}
  <main>
    <div class="stats"><div><b>${activos.length}</b><span>activos</span></div><div><b>${ganados}/${jugados}</b><span>ganados</span></div></div>
    <div class="segmento">
      <button class="${pestanaMisRetos === 'activos' ? 'sel' : ''}" data-accion="pestana" data-v="activos">Activos (${activos.length})</button>
      <button class="${pestanaMisRetos === 'hist' ? 'sel' : ''}" data-accion="pestana" data-v="hist">Historial (${hist.length})</button>
    </div>
    ${lista.map((r) => tarjetaReto(r)).join('') || `<p class="vacio">${pestanaMisRetos === 'activos' ? 'No tienes retos activos.' : 'Aún no hay historial.'}</p><a class="btn btn-primario" href="#/crear">Crear mi primer reto</a>`}
  </main>${navInferior('mis-retos')}`;
};

const TIPO_MOV = { bono: 'Bono de bienvenida', deposito: 'Depósito', retiro: 'Retiro', bloqueo: 'Apuesta en custodia', reembolso: 'Reembolso', liquidacion: 'Premio' };
vistas.billetera = () => {
  const movs = M.movimientosDe(estado, yoId);
  const enJuego = Object.values(estado.retos).filter((r) => ['abierto', 'emparejado'].includes(r.estado))
    .reduce((s, r) => s + (r.creadorId === yoId ? r.monto : 0) + (r.rivalId === yoId ? r.montoRival : 0), 0);
  return `${encabezado('Billetera')}
  <main>
    <div class="tarjeta saldo-hero">
      <span class="sub">Disponible</span>
      <div class="saldo-grande">${M.fmt(M.saldoUsuario(estado, yoId))}</div>
      <span class="sub">En custodia: ${M.fmt(enJuego)}</span>
      <div class="fila-btn">
        <button class="btn btn-primario" data-accion="depositar">${MARCA.modoDinero === 'demo' ? '+ $500 fichas demo' : 'Depositar'}</button>
        <button class="btn btn-secundario" data-accion="retirar">Retirar</button>
      </div>
    </div>
    <h2 class="sec-titulo">Movimientos</h2>
    <ul class="movs">${movs.map((m) => `<li><div><b>${TIPO_MOV[m.tipo] || m.tipo}</b><span class="sub">${fechaCorta(m.fecha)}</span></div><span class="${m.monto > 0 ? 'pos' : 'neg'}">${m.monto > 0 ? '+' : ''}${M.fmt(m.monto)}</span></li>`).join('')}</ul>
  </main>${navInferior('billetera')}`;
};

vistas.perfil = () => {
  const u = yo();
  return `${encabezado('Perfil')}
  <main>
    <div class="tarjeta perfil-hero"><div class="avatar grande">${esc(u.nombre[0])}</div><div><b>${esc(u.nombre)}</b><div class="sub">${esc(u.email || 'sin correo')}</div>${u.esAdmin ? '<span class="pill pill-vivo">Admin</span>' : ''}</div></div>
    <ul class="menu">
      ${u.esAdmin ? `<li><a href="#/admin">Panel de la casa (admin) <span>›</span></a></li>` : ''}
      <li><a href="#/juego-responsable">Juego responsable y límites <span>›</span></a></li>
      <li><a href="mailto:${MARCA.correoSoporte}">Soporte <span>›</span></a></li>
      <li><button data-accion="elegir-cuenta">Cambiar de cuenta (demo) <span>›</span></button></li>
      <li><button data-accion="salir">Cerrar sesión <span>›</span></button></li>
      <li><button class="peligro" data-accion="reiniciar">Borrar datos demo de este dispositivo <span>›</span></button></li>
    </ul>
    <p class="legal">${esc(MARCA.nombre)} es un nombre temporal. Versión MVP en modo demo: ninguna ficha tiene valor monetario.</p>
  </main>${navInferior('perfil')}`;
};

vistas['juego-responsable'] = () => `${encabezado('Juego responsable', true)}
  <main><div class="tarjeta texto">
    <p>Apostar debe ser entretenimiento, nunca una forma de ganar dinero ni de recuperar pérdidas.</p>
    <ul><li>Límite de depósito diario/semanal/mensual (próximamente).</li><li>Pausa temporal o autoexclusión (próximamente).</li><li>Solo mayores de ${MARCA.edadMinima} años.</li></ul>
    <p class="sub">Esta pantalla es obligatoria antes de operar con dinero real.</p>
  </div></main>`;

vistas.cuentas = () => `
  <main class="bienvenida"><h2 class="sec-titulo">¿Quién eres?</h2>
    ${usuariosReales().map((u) => `<button class="tarjeta fila-cuenta" data-accion="entrar-como" data-id="${u.id}"><div class="avatar">${esc(u.nombre[0])}</div><div><b>${esc(u.nombre)}</b><div class="sub">${M.fmt(M.saldoUsuario(estado, u.id))}</div></div></button>`).join('')}
    <button class="btn btn-secundario" data-accion="nueva-cuenta">Crear otra cuenta</button>
    <p class="legal">En la demo varias personas pueden usar el mismo teléfono para probar el 1 vs 1. Con backend, cada quien entra con su correo.</p>
  </main>`;

vistas.admin = () => {
  if (!yo().esAdmin) return vistas.noEncontrado();
  const m = M.metricasCasa(estado);
  const eventos = Object.values(estado.eventos).filter((e) => ['abierto', 'cerrado'].includes(e.estado));
  return `${encabezado('Panel de la casa', true)}
  <main>
    <div class="kpis">
      <div><span>Ingresos (comisión)</span><b>${M.fmt(m.ingresosCasa)}</b></div>
      <div><span>Volumen emparejado</span><b>${M.fmt(m.volumen)}</b></div>
      <div><span>En custodia</span><b>${M.fmt(m.enEscrow)}</b></div>
      <div><span>Emparejamiento</span><b>${Math.round(m.tasaEmparejamiento * 100)}%</b></div>
      <div><span>Usuarios</span><b>${m.usuarios}</b></div>
      <div><span>Libro cuadra</span><b class="${m.cuadra ? 'pos' : 'neg'}">${m.cuadra ? 'Sí ✓' : 'NO ✗'}</b></div>
    </div>
    <h2 class="sec-titulo">Resolver eventos</h2>
    ${eventos.map((e) => {
      const n = Object.values(estado.retos).filter((r) => r.eventoId === e.id && ['abierto', 'emparejado'].includes(r.estado)).length;
      return `<div class="tarjeta admin-ev">
        <div><span class="liga">${esc(e.liga)}</span> <b>${esc(e.titulo)}</b><div class="sub">${n} retos activos · ${e.estado}</div></div>
        <div class="fila-btn">
          ${e.estado === 'abierto' ? `<button class="btn btn-chico btn-secundario" data-accion="cerrar-ev" data-id="${e.id}">Cerrar apuestas</button>` : ''}
          <button class="btn btn-chico" data-accion="resolver" data-id="${e.id}" data-v="0">Ganó ${esc(e.opciones[0])}</button>
          <button class="btn btn-chico" data-accion="resolver" data-id="${e.id}" data-v="1">Ganó ${esc(e.opciones[1])}</button>
          <button class="btn btn-chico btn-fantasma" data-accion="resolver" data-id="${e.id}" data-v="anulado">Anular</button>
        </div></div>`;
    }).join('') || '<p class="vacio">Nada por resolver.</p>'}
    <h2 class="sec-titulo">Nuevo evento</h2>
    <form class="tarjeta form" data-form="evento">
      <label>Liga<input name="liga" required placeholder="Liga MX"></label>
      <label>Opción A<input name="a" required placeholder="Equipo local"></label>
      <label>Opción B<input name="b" required placeholder="Equipo visitante"></label>
      <label>Fecha y hora<input name="inicia" type="datetime-local" required></label>
      <button class="btn btn-primario">Crear evento</button>
    </form>
  </main>`;
};

vistas.noEncontrado = () => `${encabezado('', true)}<main><p class="vacio">No encontramos eso.</p><a class="btn btn-primario" href="#/inicio">Ir al inicio</a></main>`;

// ---------- Router ----------
const usuariosReales = () => Object.values(estado.usuarios).filter((u) => !estado.demo?.bots.includes(u.id));
let historial = [];
function render(arriba = false) {
  const [, ruta = 'inicio', param] = location.hash.split('/');
  if (!yoId && !['bienvenida', 'cuentas'].includes(ruta)) {
    // guardamos el link de reto para regresar después del registro
    if (ruta === 'reto' && param) sessionStorage.setItem('duelo_destino', location.hash);
    return ir('/bienvenida');
  }
  if (yoId && ruta === 'bienvenida') return ir('/inicio');
  const vista = vistas[ruta] || vistas.noEncontrado;
  $app.innerHTML = vista(param);
  if (historial[historial.length - 1] !== location.hash) historial.push(location.hash);
  if (arriba) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => render(true));

function entrar(id) {
  yoId = id; A.sesion.set(id);
  const destino = sessionStorage.getItem('duelo_destino');
  sessionStorage.removeItem('duelo_destino');
  ir(destino ? destino.slice(1) : '/inicio');
}

// ---------- Eventos de UI ----------
$app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  if (ev.target.dataset.form === 'registro') {
    const esPrimero = usuariosReales().length === 0; // el primer usuario del dispositivo es admin (fundador)
    const u = operar(() => M.registrarUsuario(estado, { nombre: f.get('nombre'), email: f.get('email'), esAdmin: esPrimero }), '¡Bienvenido! Ya tienes fichas demo.');
    if (u) entrar(u.id);
  }
  if (ev.target.dataset.form === 'evento') {
    const ok = operar(() => M.crearEvento(estado, { titulo: `${f.get('a')} vs ${f.get('b')}`, liga: f.get('liga'), opciones: [f.get('a'), f.get('b')], inicia: new Date(f.get('inicia')).toISOString() }), 'Evento creado');
    if (ok) render();
  }
});

$app.addEventListener('input', (ev) => {
  const c = ev.target.dataset.campo;
  if (!c || !borrador) return;
  if (c === 'privado') borrador.privado = ev.target.checked;
  else borrador[c] = ev.target.value;
  // re-render solo del resumen para no perder el foco del input
  const pos = ev.target.selectionStart;
  render();
  const nuevo = $app.querySelector(`[data-campo="${c}"]`);
  if (nuevo && c !== 'privado') { nuevo.focus(); try { nuevo.setSelectionRange(pos, pos); } catch {} }
});

$app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-accion]');
  if (!el) return;
  const { accion, id, v } = el.dataset;
  switch (accion) {
    case 'atras': historial.pop(); history.length > 1 && historial.length ? history.back() : ir('/inicio'); break;
    case 'lado': borrador.lado = +v; render(); break;
    case 'monto': borrador.monto = +v; render(); break;
    case 'parejo': borrador.parejo = v === '1'; render(); break;
    case 'pestana': pestanaMisRetos = v; render(); break;
    case 'publicar': {
      const b = borrador;
      const r = operar(() => M.crearReto(estado, {
        creadorId: yoId, eventoId: b.eventoId, lado: b.lado, privado: b.privado,
        monto: M.aCentavos(b.monto), montoRival: M.aCentavos(b.parejo ? b.monto : b.rival),
      }), 'Reto publicado. Tu dinero está en custodia.');
      if (r) { borrador = null; ir(`/reto/${r.id}`); }
      break;
    }
    case 'aceptar': if (operar(() => M.aceptarReto(estado, id, yoId), '¡Reto aceptado! Que gane el mejor.')) render(); break;
    case 'cancelar': if (await preguntar('¿Cancelar el reto? Recuperas tu dinero completo.', { ok: 'Cancelar reto', peligro: true }) && operar(() => M.cancelarReto(estado, id, yoId), 'Reto cancelado')) render(); break;
    case 'compartir': {
      const r = estado.retos[id]; const e = estado.eventos[r.eventoId];
      const url = `${location.origin}${location.pathname}#/reto/${id}`;
      const texto = `Te reto: ${e.titulo}. Yo voy con ${e.opciones[r.lado]}, pon ${M.fmt(r.montoRival)} y el que gane se lleva el bote.`;
      try {
        if (navigator.share) await navigator.share({ title: MARCA.nombre, text: texto, url });
        else { await navigator.clipboard.writeText(`${texto} ${url}`); toast('Link copiado'); }
      } catch { /* el usuario cerró el diálogo */ }
      break;
    }
    case 'depositar':
      if (MARCA.modoDinero !== 'demo') return toast('Pagos reales aún no habilitados', 'error');
      operar(() => M.depositar(estado, yoId, 50000), 'Agregamos $500 en fichas demo'); render(); break;
    case 'retirar': {
      const monto = await preguntar('¿Cuánto quieres retirar? (demo)', { ok: 'Retirar', campo: '100' });
      if (monto && operar(() => M.retirar(estado, yoId, M.aCentavos(monto)), 'Retiro registrado (demo)')) render();
      break;
    }
    case 'cerrar-ev': if (operar(() => M.cerrarEvento(estado, id), 'Apuestas cerradas para este evento')) render(); break;
    case 'resolver': {
      const e = estado.eventos[id];
      const txt = v === 'anulado' ? 'ANULAR (se devuelve todo)' : `ganó ${e.opciones[+v]}`;
      if (!(await preguntar(`${e.titulo} → ${txt}. Esto paga a los ganadores y no se puede deshacer.`, { ok: 'Resolver' }))) break;
      const res = operar(() => M.resolverEvento(estado, id, v === 'anulado' ? 'anulado' : +v));
      if (res) { toast(`${res.liquidados} liquidados, ${res.reembolsados} reembolsados · comisión ${M.fmt(res.comisionTotal)}`); render(); }
      break;
    }
    case 'elegir-cuenta': ir('/cuentas'); break;
    case 'entrar-como': entrar(id); break;
    case 'nueva-cuenta': yoId = null; A.sesion.set(null); ir('/bienvenida'); break;
    case 'salir': yoId = null; A.sesion.set(null); ir('/bienvenida'); break;
    case 'reiniciar':
      if (await preguntar('Esto borra todas las cuentas y retos demo de este dispositivo.', { ok: 'Borrar todo', peligro: true })) { A.reiniciar(); location.hash = ''; location.reload(); }
      break;
  }
});

render(true);
