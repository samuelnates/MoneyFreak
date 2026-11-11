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
const pct = (x) => `${Math.round(x * 100)}%`;
const mult = (x) => `x${x.toFixed(2)}`;
const CFG = M.CONFIG;

document.title = `${MARCA.nombre} · Apuestas 1 vs 1`;

// ---------- Toast y diálogo ----------
function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('fuera'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// Diálogo propio (confirm/prompt nativos no funcionan en todos los contenedores
// y se ven fuera de marca). Devuelve una Promise: true/false.
function preguntar(mensaje, { ok = 'Confirmar', peligro = false, detalle = '' } = {}) {
  return new Promise((resolver) => {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `<div class="modal tarjeta" role="dialog" aria-modal="true">
      <p>${esc(mensaje)}</p>${detalle ? `<div class="sub">${detalle}</div>` : ''}
      <div class="fila-btn">
        <button class="btn btn-secundario" data-r="no">Volver</button>
        <button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-r="si">${esc(ok)}</button>
      </div></div>`;
    const cerrar = (v) => { fondo.remove(); resolver(v); };
    fondo.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (r === 'si') cerrar(true);
      else if (r === 'no' || e.target === fondo) cerrar(false);
    });
    document.body.appendChild(fondo);
    fondo.querySelector('[data-r="si"]').focus();
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
  abierto: ['Esperando rival', 'pend'], emparejado: ['Comprometido · en juego', 'vivo'], liquidado: ['Liquidado', 'fin'],
  cancelado: ['Cancelado', 'gris'], expirado: ['Sin rival · reembolsado', 'gris'], anulado: ['Anulado · reembolsado', 'gris'],
};
const VEREDICTO = {
  ventaja: ['Te conviene', 'ok'], justo: ['Justo', 'neutro'], desventaja: ['Arriesgas de más', 'malo'], sin_datos: ['Sin datos de mercado', 'neutro'],
};
const badgeVeredicto = (an) => {
  const [txt, cls] = VEREDICTO[an.veredicto];
  const extra = an.valorEsperado != null && an.veredicto !== 'justo' ? ` ${an.valorEsperado > 0 ? '+' : ''}${pct(an.valorEsperado)}` : '';
  return `<span class="ver ver-${cls}">${txt}${extra}</span>`;
};

function encabezado(titulo, atras) {
  return `
  <header class="barra">
    ${atras ? `<button class="btn-icono" data-accion="atras" aria-label="Atrás">‹</button>` : `<span class="logo">${esc(MARCA.nombre)}</span>`}
    ${titulo ? `<h1 class="barra-titulo">${esc(titulo)}</h1>` : '<span></span>'}
    <a class="chip-saldo" href="#/billetera" aria-label="Saldo">${M.fmt(M.saldoUsuario(estado, yoId))}</a>
  </header>
  ${MARCA.modoDinero === 'demo' ? `<div class="aviso-demo">Modo demo · fichas sin valor real · pagos simulados</div>` : ''}`;
}

function navInferior(activo) {
  const items = [['inicio', '⌂', 'Inicio'], ['mis-retos', '⚔', 'Mis retos'], ['crear', '+', 'Retar'], ['billetera', '◎', 'Billetera'], ['perfil', '☺', 'Perfil']];
  return `<nav class="nav-inf">${items.map(([r, i, t]) =>
    `<a href="#/${r}" class="${r === 'crear' ? 'nav-crear' : ''} ${activo === r ? 'activo' : ''}"><span class="nav-ico">${i}</span><span>${t}</span></a>`).join('')}</nav>`;
}

// Barra de probabilidad del mercado para un evento.
function barraMercado(ev) {
  if (!ev.probabilidades) return '<p class="sub">Sin datos de mercado para este evento.</p>';
  const [a, b] = ev.probabilidades;
  return `<div class="mercado">
    <div class="mercado-etq"><span>${esc(ev.opciones[0])} <b>${pct(a)}</b></span><span><b>${pct(b)}</b> ${esc(ev.opciones[1])}</span></div>
    <div class="mercado-barra" role="img" aria-label="Probabilidad según el mercado: ${esc(ev.opciones[0])} ${pct(a)}, ${esc(ev.opciones[1])} ${pct(b)}"><i style="width:${a * 100}%"></i></div>
    <div class="sub">Probabilidad según el mercado · referencia, no garantía</div>
  </div>`;
}

function tarjetaReto(r, { mostrarEvento = true } = {}) {
  const ev = estado.eventos[r.eventoId];
  const creador = estado.usuarios[r.creadorId];
  const soyCreador = r.creadorId === yoId;
  const soyRival = r.rivalId === yoId;
  const soyParte = soyCreador || soyRival;
  const st = M.estadisticasReto(estado, r);
  // Siempre muestro la perspectiva de "yo": mi lado si participo, o el lado que me tocaría si acepto.
  const yoCreador = soyCreador;
  const lado = yoCreador ? r.lado : 1 - r.lado;
  const pongo = yoCreador ? r.monto : r.montoRival;
  const an = yoCreador ? st.creador : st.rival;
  const [etq, cls] = ETIQUETA_ESTADO[r.estado];
  let resultado = '';
  if (r.estado === 'liquidado' && soyParte) {
    const gane = r.ganadorId === yoId;
    resultado = `<span class="res ${gane ? 'res-gane' : 'res-perdi'}">${gane ? `Ganaste ${M.fmt(r.monto + r.montoRival - r.comision)}` : 'Perdiste'}</span>`;
  }
  return `
  <a class="tarjeta reto" href="#/reto/${r.id}">
    ${mostrarEvento ? `<div class="reto-evento"><span class="liga">${esc(ev.liga)}</span> ${esc(ev.titulo)}</div>` : ''}
    <div class="reto-cuerpo">
      <div>
        <div class="reto-quien">${soyCreador ? 'Tu reto' : soyRival ? `Contra <b>${esc(creador.nombre)}</b>` : `Reto de <b>${esc(creador.nombre)}</b>`}</div>
        <div class="reto-lado">${soyParte ? 'Vas con' : 'Te toca'} <b>${esc(ev.opciones[lado])}</b></div>
        <div class="momio">${M.fmt(r.monto)} vs ${M.fmt(r.montoRival)}</div>
      </div>
      <div class="reto-montos">
        <div class="sub">${soyParte ? 'Pusiste' : 'Pones'}</div>
        <div class="monto-grande">${M.fmt(pongo)}</div>
        <div class="paga">Paga ${mult(an.multiplicador)}</div>
      </div>
    </div>
    <div class="reto-pie"><span class="pill pill-${cls}">${etq}</span>${resultado}${r.estado === 'abierto' && !soyParte ? badgeVeredicto(an) : ''}${r.privado ? '<span class="pill pill-gris">Privado</span>' : ''}</div>
  </a>`;
}

function panelEstadisticas(an, { titulo, pongo, recibo }) {
  return `<div class="stats-reto">
    <div class="stats-titulo"><b>${titulo}</b>${badgeVeredicto(an)}</div>
    <dl>
      <div><dt>Pone</dt><dd>${M.fmt(pongo)}</dd></div>
      <div><dt>Si gana recibe</dt><dd>${M.fmt(recibo)} <small>${mult(an.multiplicador)}</small></dd></div>
      <div><dt>Necesita acertar más de</dt><dd>${pct(an.probEquilibrio)}</dd></div>
      <div><dt>El mercado le da</dt><dd>${an.probMercado == null ? '—' : pct(an.probMercado)}</dd></div>
    </dl>
  </div>`;
}

// ---------- Pantallas ----------
const vistas = {};

vistas.bienvenida = () => `
  <main class="bienvenida">
    <div class="hero">
      <div class="logo-grande">${esc(MARCA.nombre)}</div>
      <p class="lema">${esc(MARCA.lema)}</p>
      <ul class="como">
        <li><b>1.</b> Elige un partido, tu lado y tu momio: parejo o 100 vs 50, tú decides.</li>
        <li><b>2.</b> Reta a un amigo o publica tu reto.</li>
        <li><b>3.</b> Al aceptarse, el dinero queda en custodia. Gana el que acierta.</li>
      </ul>
    </div>
    <form class="tarjeta form" data-form="registro">
      <label>¿Cómo te llamas?<input id="reg-nombre" name="nombre" required maxlength="30" autocomplete="nickname" placeholder="Tu apodo"></label>
      <label>Correo<input id="reg-email" name="email" type="email" autocomplete="email" placeholder="tu@correo.com"></label>
      <label class="check"><input id="reg-edad" type="checkbox" name="edad" required> Tengo ${MARCA.edadMinima} años o más y acepto los términos.</label>
      <button class="btn btn-primario" type="submit">Entrar con ${M.fmt(CFG.bonoBienvenida)} en fichas demo</button>
      ${usuariosReales().length ? `<button class="btn btn-fantasma" type="button" data-accion="elegir-cuenta">Ya tengo cuenta en este dispositivo</button>` : ''}
    </form>
  </main>`;

vistas.inicio = () => {
  const abiertos = Object.values(estado.retos).filter((r) => r.estado === 'abierto' && !r.privado && r.creadorId !== yoId);
  // Los que más le convienen a quien acepta, primero
  abiertos.sort((a, b) => (M.estadisticasReto(estado, b).rival.valorEsperado ?? 0) - (M.estadisticasReto(estado, a).rival.valorEsperado ?? 0));
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
          <div class="evento-info"><span class="liga">${esc(e.liga)}</span><div class="evento-titulo">${esc(e.titulo)}</div><div class="sub">${fechaCorta(e.inicia)}</div>
          ${e.probabilidades ? `<div class="mini-mercado"><i style="width:${e.probabilidades[0] * 100}%"></i></div><div class="sub">${pct(e.probabilidades[0])} · ${pct(e.probabilidades[1])}</div>` : ''}</div>
          <div class="evento-der">${n ? `<span class="pill pill-pend">${n} ${n === 1 ? 'abierto' : 'abiertos'}</span>` : ''}<span class="btn btn-chico">Retar</span></div>
        </a>`;
      }).join('') || '<p class="vacio">No hay eventos abiertos.</p>'}
    </section>
  </main>${navInferior('inicio')}`;
};

vistas.evento = (id) => {
  const e = estado.eventos[id];
  if (!e) return vistas.noEncontrado();
  const retos = Object.values(estado.retos).filter((r) => r.eventoId === id && r.estado === 'abierto' && !r.privado);
  const justo = e.probabilidades ? [0, 1].map((i) => `Por cada $100 a <b>${esc(e.opciones[i])}</b>, un rival justo pone <b>${M.fmt(M.montoJusto(10000, e.probabilidades[i]))}</b>`).join('<br>') : '';
  return `${encabezado(e.liga, true)}
  <main>
    <div class="tarjeta evento-hero">
      <div class="sub">${fechaCorta(e.inicia)}</div>
      <div class="versus"><div>${esc(e.opciones[0])}</div><span>vs</span><div>${esc(e.opciones[1])}</div></div>
      ${barraMercado(e)}
      ${justo ? `<p class="justo">${justo}</p>` : ''}
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
  if (!borrador || borrador.eventoId !== eventoId) borrador = { eventoId, lado: null, monto: 100, rival: 100, modo: 'parejo', privado: false };
  const b = borrador;
  const p = b.lado !== null && e.probabilidades ? e.probabilidades[b.lado] : null;
  if (b.modo === 'parejo') b.rival = b.monto;
  if (b.modo === 'justo' && p) b.rival = Math.round(M.montoJusto(M.aCentavos(b.monto), p) / 100);
  const mio = M.aCentavos(b.monto) || 0;
  const suyo = M.aCentavos(b.rival) || 0;
  const valido = mio > 0 && suyo > 0;
  const anYo = valido ? M.analizarApuesta({ mio, suyo, p }) : null;
  const anRival = valido ? M.analizarApuesta({ mio: suyo, suyo: mio, p: p == null ? null : 1 - p }) : null;
  const ratio = valido ? Math.max(mio, suyo) / Math.min(mio, suyo) : 1;
  return `${encabezado('Nuevo reto', true)}
  <main>
    <div class="paso"><span class="paso-n">1</span> ¿Quién gana? <span class="sub">${esc(e.titulo)}</span></div>
    <div class="lados">${e.opciones.map((o, i) => `<button class="lado ${b.lado === i ? 'sel' : ''}" data-accion="lado" data-v="${i}">${esc(o)}${e.probabilidades ? `<small>${pct(e.probabilidades[i])} según el mercado</small>` : ''}</button>`).join('')}</div>

    <div class="paso"><span class="paso-n">2</span> ¿Cuánto pones?</div>
    <div class="montos">${[50, 100, 200, 500, 1000].map((m) => `<button class="chip ${+b.monto === m ? 'sel' : ''}" data-accion="monto" data-v="${m}">$${m}</button>`).join('')}</div>
    <label class="campo-monto">$<input id="crear-monto" type="number" inputmode="decimal" min="10" step="10" value="${esc(b.monto)}" data-campo="monto" aria-label="Lo que pones"></label>

    <div class="paso"><span class="paso-n">3</span> ¿Cuánto pone tu rival? <span class="sub">tu momio</span></div>
    <div class="segmento">
      <button class="${b.modo === 'parejo' ? 'sel' : ''}" data-accion="modo" data-v="parejo">Parejo</button>
      <button class="${b.modo === 'justo' ? 'sel' : ''}" data-accion="modo" data-v="justo" ${e.probabilidades ? '' : 'disabled'}>Justo (mercado)</button>
      <button class="${b.modo === 'libre' ? 'sel' : ''}" data-accion="modo" data-v="libre">Tú decides</button>
    </div>
    ${b.modo === 'libre' ? `<label class="campo-monto">$<input id="crear-rival" type="number" inputmode="decimal" min="10" step="10" value="${esc(b.rival)}" data-campo="rival" aria-label="Lo que pone tu rival"></label>
      <div class="montos"><span class="sub">Tu rival pone:</span>${[[0.25, '¼'], [0.5, 'la mitad'], [2, 'el doble'], [3, 'x3'], [5, 'x5']].map(([f, t]) => `<button class="chip" data-accion="ratio" data-v="${f}">${t}</button>`).join('')}</div>` : ''}
    ${b.modo === 'justo' && b.lado === null ? '<p class="sub">Elige un lado para calcular el momio justo.</p>' : ''}
    ${ratio > CFG.ratioMaximo ? `<p class="error-campo">El momio máximo es ${CFG.ratioMaximo} a 1.</p>` : ''}

    ${valido ? `
    <div class="momio-grande">${M.fmt(mio)} <span>vs</span> ${M.fmt(suyo)}</div>
    ${b.lado !== null ? `<div class="stats-par">
      ${panelEstadisticas(anYo, { titulo: 'Tú', pongo: mio, recibo: M.pagoSiGana(mio, suyo) })}
      ${panelEstadisticas(anRival, { titulo: 'Tu rival', pongo: suyo, recibo: M.pagoSiGana(suyo, mio) })}
    </div>
    <p class="sub centro">${anRival.veredicto === 'ventaja' ? 'Le das ventaja a tu rival: alguien lo aceptará rápido.' : anRival.veredicto === 'desventaja' ? 'Tu rival arriesga de más: puede tardar en encontrar quien acepte.' : 'Momio cercano al mercado.'}</p>` : ''}
    <div class="resumen">
      <div><span>Bote total</span><b>${M.fmt(mio + suyo)}</b></div>
      <div><span>Comisión (${pct(CFG.tasaComision)} de tu ganancia)</span><b>−${M.fmt(M.comisionDe(suyo))}</b></div>
      <div class="total"><span>Si ganas recibes</span><b>${M.fmt(M.pagoSiGana(mio, suyo))}</b></div>
    </div>` : ''}

    <label class="check fila"><input id="crear-privado" type="checkbox" data-campo="privado" ${b.privado ? 'checked' : ''}> Reto privado (solo con link)</label>
    <button class="btn btn-primario" data-accion="publicar" ${b.lado === null || !valido ? 'disabled' : ''}>${b.lado === null ? 'Elige un lado' : 'Publicar reto'}</button>
    <p class="legal">Tu dinero queda en custodia. Mientras nadie acepte puedes cancelar y recuperarlo completo; una vez aceptado es un compromiso y no se puede cancelar.</p>
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
  const st = M.estadisticasReto(estado, r);
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
      ${barraMercado(e)}
      <span class="pill pill-${cls}">${etq}</span>
    </div>
    <div class="stats-par">
      ${panelEstadisticas(st.creador, { titulo: soyCreador ? 'Tú' : esc(creador.nombre), pongo: r.monto, recibo: M.pagoSiGana(r.monto, r.montoRival) })}
      ${panelEstadisticas(st.rival, { titulo: r.rivalId === yoId ? 'Tú' : puedoAceptar ? 'Tú si aceptas' : 'Rival', pongo: r.montoRival, recibo: M.pagoSiGana(r.montoRival, r.monto) })}
    </div>
    ${puedoAceptar ? `<button class="btn btn-primario" data-accion="aceptar" data-id="${r.id}">Aceptar · pongo ${M.fmt(r.montoRival)} para ganar ${M.fmt(M.pagoSiGana(r.montoRival, r.monto))}</button>` : ''}
    ${r.estado === 'abierto' ? `<button class="btn btn-secundario" data-accion="compartir" data-id="${r.id}">Mandar a un amigo</button>` : ''}
    ${soyCreador && r.estado === 'abierto' ? `<button class="btn btn-fantasma peligro" data-accion="cancelar" data-id="${r.id}">Cancelar y recuperar ${M.fmt(r.monto)}</button>` : ''}
    ${r.estado === 'emparejado' ? `<p class="legal">🔒 Compromiso cerrado el ${fechaCorta(r.aceptado)}. El dinero de ambos está en custodia hasta el resultado oficial.</p>` : ''}
  </main>${navInferior('mis-retos')}`;
};

let pestanaMisRetos = 'activos';
vistas['mis-retos'] = () => {
  const mios = Object.values(estado.retos).filter((r) => r.creadorId === yoId || r.rivalId === yoId).reverse();
  const activos = mios.filter((r) => ['abierto', 'emparejado'].includes(r.estado));
  const hist = mios.filter((r) => !['abierto', 'emparejado'].includes(r.estado));
  const lista = pestanaMisRetos === 'activos' ? activos : hist;
  const liquidados = hist.filter((r) => r.estado === 'liquidado');
  const ganados = liquidados.filter((r) => r.ganadorId === yoId).length;
  const neto = liquidados.reduce((s, r) => {
    const puse = r.creadorId === yoId ? r.monto : r.montoRival;
    return s + (r.ganadorId === yoId ? r.monto + r.montoRival - r.comision - puse : -puse);
  }, 0);
  return `${encabezado('Mis retos')}
  <main>
    <div class="stats"><div><b>${activos.length}</b><span>activos</span></div><div><b>${ganados}/${liquidados.length}</b><span>ganados</span></div><div><b class="${neto >= 0 ? 'pos' : 'neg-r'}">${neto >= 0 ? '+' : ''}${M.fmt(neto)}</b><span>resultado</span></div></div>
    <div class="segmento">
      <button class="${pestanaMisRetos === 'activos' ? 'sel' : ''}" data-accion="pestana" data-v="activos">Activos (${activos.length})</button>
      <button class="${pestanaMisRetos === 'hist' ? 'sel' : ''}" data-accion="pestana" data-v="hist">Historial (${hist.length})</button>
    </div>
    ${lista.map((r) => tarjetaReto(r)).join('') || `<p class="vacio">${pestanaMisRetos === 'activos' ? 'No tienes retos activos.' : 'Aún no hay historial.'}</p><a class="btn btn-primario" href="#/crear">Crear mi primer reto</a>`}
  </main>${navInferior('mis-retos')}`;
};

// ---------- Billetera ----------
const TIPO_MOV = {
  bono: 'Bono de bienvenida', deposito: 'Depósito', bloqueo: 'Apuesta en custodia', reembolso: 'Reembolso',
  liquidacion: 'Premio', retiro_solicitado: 'Retiro solicitado', retiro_rechazado: 'Retiro rechazado · devuelto',
};
const ESTADO_RETIRO = { en_revision: ['En revisión de seguridad', 'vivo'], pagado: ['Pagado', 'fin'], rechazado: ['Rechazado · devuelto', 'gris'] };

vistas.billetera = () => {
  const movs = M.movimientosDe(estado, yoId);
  const enJuego = Object.values(estado.retos).filter((r) => ['abierto', 'emparejado'].includes(r.estado))
    .reduce((s, r) => s + (r.creadorId === yoId ? r.monto : 0) + (r.rivalId === yoId ? r.montoRival : 0), 0);
  const pendientes = Object.values(estado.depositos).filter((d) => d.usuarioId === yoId && d.estado === 'pendiente');
  const retiros = Object.values(estado.retiros).filter((r) => r.usuarioId === yoId).reverse().slice(0, 5);
  return `${encabezado('Billetera')}
  <main>
    <div class="tarjeta saldo-hero">
      <span class="sub">Disponible</span>
      <div class="saldo-grande">${M.fmt(M.saldoUsuario(estado, yoId))}</div>
      <span class="sub">Comprometido en retos: ${M.fmt(enJuego)}</span>
      <div class="fila-btn">
        <a class="btn btn-primario" href="#/depositar">Depositar</a>
        <a class="btn btn-secundario" href="#/retirar">Retirar</a>
      </div>
    </div>
    ${pendientes.length ? `<h2 class="sec-titulo">Depósitos pendientes</h2>${pendientes.map((d) => `<a class="tarjeta fila-pend" href="#/deposito/${d.id}"><div><b>${esc(CFG.metodosDeposito[d.metodo].nombre)}</b><div class="sub">${fechaCorta(d.creado)}</div></div><b>${M.fmt(d.monto)}</b></a>`).join('')}` : ''}
    ${retiros.length ? `<h2 class="sec-titulo">Retiros</h2>${retiros.map((r) => { const [t, c] = ESTADO_RETIRO[r.estado]; return `<div class="tarjeta fila-pend"><div><b>${M.fmt(r.neto)}</b> a CLABE ···${esc(r.clabe.slice(-4))}<div class="sub">${fechaCorta(r.creado)}${r.motivo ? ` · ${esc(r.motivo)}` : ''}</div></div><span class="pill pill-${c}">${t}</span></div>`; }).join('')}` : ''}
    <h2 class="sec-titulo">Movimientos</h2>
    <ul class="movs">${movs.map((m) => `<li><div><b>${TIPO_MOV[m.tipo] || m.tipo}</b><span class="sub">${fechaCorta(m.fecha)}</span></div><span class="${m.monto > 0 ? 'pos' : 'neg'}">${m.monto > 0 ? '+' : ''}${M.fmt(m.monto)}</span></li>`).join('')}</ul>
  </main>${navInferior('billetera')}`;
};

let depBorrador = { monto: 500, metodo: 'spei' };
vistas.depositar = () => {
  const m = CFG.metodosDeposito[depBorrador.metodo];
  return `${encabezado('Depositar', true)}
  <main>
    <div class="paso"><span class="paso-n">1</span> ¿Cuánto?</div>
    <div class="montos">${[100, 200, 500, 1000, 2000].map((v) => `<button class="chip ${+depBorrador.monto === v ? 'sel' : ''}" data-accion="dep-monto" data-v="${v}">$${v.toLocaleString('es-MX')}</button>`).join('')}</div>
    <label class="campo-monto">$<input id="dep-monto" type="number" inputmode="decimal" min="50" step="50" value="${esc(depBorrador.monto)}" data-campo="dep-monto" aria-label="Monto a depositar"></label>
    <div class="paso"><span class="paso-n">2</span> ¿Cómo?</div>
    <div class="metodos">${Object.entries(CFG.metodosDeposito).map(([k, x]) => `
      <button class="metodo ${depBorrador.metodo === k ? 'sel' : ''}" data-accion="dep-metodo" data-v="${k}">
        <span class="metodo-ico">${{ spei: '⇄', tarjeta: '▭', oxxo: '$' }[k]}</span>
        <span><b>${esc(x.nombre)}</b><span class="sub">${esc(x.detalle)} · ${M.fmt(x.min)} a ${M.fmt(x.max)}</span></span>
      </button>`).join('')}
      <div class="metodo deshab"><span class="metodo-ico">＋</span><span><b>Mercado Pago, Apple Pay, Google Pay</b><span class="sub">Próximamente</span></span></div>
    </div>
    <div class="resumen">
      <div><span>Comisión por depositar</span><b class="pos">Gratis</b></div>
      <div class="total"><span>Se acredita a tu saldo</span><b>${M.fmt(M.aCentavos(depBorrador.monto) || 0)}</b></div>
    </div>
    <button class="btn btn-primario" data-accion="dep-continuar">Continuar con ${esc(m.nombre)}</button>
    <p class="legal">Límite de ${M.fmt(CFG.limiteDepositoDiario)} cada 24 h (juego responsable). Solo aceptamos pagos a tu nombre.</p>
  </main>`;
};

vistas.deposito = (id) => {
  const d = estado.depositos[id];
  if (!d || d.usuarioId !== yoId) return vistas.noEncontrado();
  const m = CFG.metodosDeposito[d.metodo];
  const instrucciones = {
    spei: `<p>Transfiere exactamente <b>${M.fmt(d.monto)}</b> desde una cuenta a tu nombre a tu CLABE personal:</p>
      <div class="referencia">646 180 ${esc(d.id.slice(-11).replace(/\D/g, '7').padEnd(11, '0').slice(0, 11))}</div>
      <p class="sub">Banco: STP · Beneficiario: ${esc(MARCA.nombre)}. Se acredita en minutos, también en fin de semana.</p>`,
    tarjeta: `<p>Pago de <b>${M.fmt(d.monto)}</b> con tarjeta.</p>
      <div class="caja-segura">🔒 En producción aquí aparece el formulario seguro del procesador con 3-D Secure. Nunca vemos ni guardamos los datos de tu tarjeta.</div>`,
    oxxo: `<p>Paga <b>${M.fmt(d.monto)}</b> en cualquier OXXO dictando esta referencia:</p>
      <div class="referencia">${esc(d.referencia.replace(/(\d{4})(?=\d)/g, '$1 '))}</div>
      <p class="sub">OXXO cobra su propia comisión en caja. Se acredita aprox. 1 h después de pagar. La referencia vence en 72 h.</p>`,
  }[d.metodo];
  return `${encabezado(m.nombre, true)}
  <main>
    <div class="tarjeta texto">${instrucciones}</div>
    ${d.estado === 'pendiente'
      ? `<button class="btn btn-primario" data-accion="dep-simular" data-id="${d.id}">${{ spei: 'Simular transferencia recibida', tarjeta: 'Pagar (simulado)', oxxo: 'Simular pago en tienda' }[d.metodo]}</button>
         <p class="legal">Demo: este botón hace lo que en producción hará la notificación firmada del procesador de pagos.</p>`
      : `<p class="vacio">Depósito ${d.estado === 'acreditado' ? 'acreditado ✓' : 'fallido'}</p><a class="btn btn-secundario" href="#/billetera">Ir a mi billetera</a>`}
  </main>`;
};

let retBorrador = { monto: '', clabe: '' };
vistas.retirar = () => {
  const ro = M.rolloverDe(estado, yoId);
  const disp = M.saldoUsuario(estado, yoId);
  const monto = M.aCentavos(retBorrador.monto) || 0;
  const com = monto ? M.comisionRetiro(monto) : 0;
  const clabeOk = M.validarClabe(retBorrador.clabe);
  const avance = ro.requerido ? Math.min(1, ro.apostado / ro.requerido) : 1;
  return `${encabezado('Retirar', true)}
  <main>
    <div class="tarjeta texto">
      <div class="fila-dato"><span>Disponible para retirar</span><b>${M.fmt(disp)}</b></div>
      <div>
        <div class="fila-dato"><span>Requisito antilavado: apostar lo depositado</span><b>${M.fmt(ro.apostado)} / ${M.fmt(ro.requerido)}</b></div>
        <div class="progreso"><i style="width:${avance * 100}%"></i></div>
        ${ro.cumple ? '<span class="sub pos">✓ Cumplido</span>' : `<span class="sub">Te faltan ${M.fmt(ro.faltante)} en retos aceptados.</span>`}
      </div>
    </div>
    <label class="etiqueta" for="ret-monto">Monto</label>
    <label class="campo-monto">$<input id="ret-monto" type="number" inputmode="decimal" min="100" step="10" value="${esc(retBorrador.monto)}" placeholder="0" data-campo="ret-monto"></label>
    <button class="chip" data-accion="ret-todo">Todo (${M.fmt(disp)})</button>
    <label class="etiqueta" for="ret-clabe">CLABE de una cuenta a tu nombre (18 dígitos)</label>
    <input id="ret-clabe" class="campo-texto ${retBorrador.clabe && !clabeOk ? 'invalido' : ''}" inputmode="numeric" maxlength="18" autocomplete="off" value="${esc(retBorrador.clabe)}" placeholder="002010077777777771" data-campo="ret-clabe">
    ${retBorrador.clabe.length === 18 && !clabeOk ? '<p class="error-campo">El dígito verificador no coincide. Revisa la CLABE.</p>' : ''}
    <div class="resumen">
      <div><span>Retiras</span><b>${M.fmt(monto)}</b></div>
      <div><span>Comisión (${pct(CFG.retiro.tasa)}, mínimo ${M.fmt(CFG.retiro.minimo)})</span><b>−${M.fmt(com)}</b></div>
      <div class="total"><span>Llega a tu banco</span><b>${M.fmt(Math.max(0, monto - com))}</b></div>
    </div>
    <button class="btn btn-primario" data-accion="ret-solicitar" ${monto && clabeOk && ro.cumple ? '' : 'disabled'}>Solicitar retiro</button>
    <p class="legal">Mínimo ${M.fmt(CFG.retiro.montoMinimo)}. Pasa por revisión de seguridad (hasta 24 h). Si se rechaza, te devolvemos el monto y la comisión completos. La cuenta debe estar a tu nombre (se valida contra tu identificación).</p>
  </main>`;
};

// ---------- Perfil ----------
vistas.perfil = () => {
  const u = yo();
  const pausa = u.autoexcluidoHasta && new Date(u.autoexcluidoHasta) > new Date();
  return `${encabezado('Perfil')}
  <main>
    <div class="tarjeta perfil-hero"><div class="avatar grande">${esc(u.nombre[0])}</div><div><b>${esc(u.nombre)}</b><div class="sub">${esc(u.email || 'sin correo')}</div>${u.esAdmin ? '<span class="pill pill-vivo">Admin</span>' : ''}</div></div>
    ${pausa ? `<div class="tarjeta aviso">Tu cuenta está en pausa hasta el ${fechaCorta(u.autoexcluidoHasta)}. No puedes apostar ni depositar.</div>` : ''}
    <ul class="menu">
      ${u.esAdmin ? `<li><a href="#/admin">Panel de la casa (admin) <span>›</span></a></li>` : ''}
      <li><a href="#/seguridad">Seguridad de tu cuenta <span>›</span></a></li>
      <li><a href="#/juego-responsable">Juego responsable y límites <span>›</span></a></li>
      <li><button data-accion="elegir-cuenta">Cambiar de cuenta (demo) <span>›</span></button></li>
      <li><button data-accion="salir">Cerrar sesión <span>›</span></button></li>
      <li><button class="peligro" data-accion="reiniciar">Borrar datos demo de este dispositivo <span>›</span></button></li>
    </ul>
    <p class="legal">Soporte: ${esc(MARCA.correoSoporte)}<br>${esc(MARCA.nombre)} es un nombre temporal. Versión MVP en modo demo: ninguna ficha tiene valor monetario.</p>
  </main>${navInferior('perfil')}`;
};

vistas.seguridad = () => `${encabezado('Seguridad', true)}
  <main><div class="tarjeta texto">
    <p><b>Cómo cuidamos tu dinero</b></p>
    <ul>
      <li>El dinero de los retos queda en custodia: ni tú, ni tu rival, ni nosotros lo podemos mover hasta el resultado oficial.</li>
      <li>Cada peso queda registrado en un libro contable que se audita solo; si algo no cuadra, se congela la operación.</li>
      <li>Los retiros solo van a cuentas a tu nombre y pasan por revisión antes de pagarse.</li>
      <li>Cerramos tu sesión tras ${MINUTOS_INACTIVIDAD} minutos sin actividad.</li>
    </ul>
    <p><b>Próximamente</b></p>
    <ul><li>Verificación de identidad (INE + selfie) antes del primer retiro.</li><li>Doble factor (código por app o SMS) para entrar y para retirar.</li><li>Aviso por correo y push de cada inicio de sesión y retiro.</li></ul>
  </div></main>`;

vistas['juego-responsable'] = () => `${encabezado('Juego responsable', true)}
  <main><div class="tarjeta texto">
    <p>Apostar debe ser entretenimiento, nunca una forma de ganar dinero ni de recuperar pérdidas.</p>
    <ul><li>Límite de depósito: ${M.fmt(CFG.limiteDepositoDiario)} cada 24 h.</li><li>Solo mayores de ${MARCA.edadMinima} años.</li><li>Puedes pausar tu cuenta: durante la pausa no podrás apostar ni depositar.</li></ul>
  </div>
  <button class="btn btn-secundario peligro" data-accion="autoexcluir">Pausar mi cuenta 7 días</button>
  </main>`;

vistas.cuentas = () => `
  <main class="bienvenida"><h2 class="sec-titulo">¿Quién eres?</h2>
    ${usuariosReales().map((u) => `<button class="tarjeta fila-cuenta" data-accion="entrar-como" data-id="${u.id}"><div class="avatar">${esc(u.nombre[0])}</div><div><b>${esc(u.nombre)}</b><div class="sub">${M.fmt(M.saldoUsuario(estado, u.id))}</div></div></button>`).join('')}
    <button class="btn btn-secundario" data-accion="nueva-cuenta">Crear otra cuenta</button>
    <p class="legal">En la demo varias personas pueden usar el mismo teléfono para probar el 1 vs 1. Con backend, cada quien entra con su correo.</p>
  </main>`;

// ---------- Admin ----------
vistas.admin = () => {
  if (!yo().esAdmin) return vistas.noEncontrado();
  const m = M.metricasCasa(estado);
  const eventos = Object.values(estado.eventos).filter((e) => ['abierto', 'cerrado'].includes(e.estado));
  const alertas = M.alertasFraude(estado);
  const retiros = Object.values(estado.retiros).filter((r) => r.estado === 'en_revision');
  const nombre = (id) => esc(estado.usuarios[id]?.nombre || 'sistema');
  return `${encabezado('Panel de la casa', true)}
  <main>
    <div class="kpis">
      <div><span>Comisión de apuestas</span><b>${M.fmt(m.comisionApuestas)}</b></div>
      <div><span>Comisión de retiros</span><b>${M.fmt(m.comisionRetiros)}</b></div>
      <div><span>Costos de pago</span><b>${M.fmt(m.costosPago)}</b></div>
      <div><span>Resultado de la casa</span><b class="${m.resultadoCasa >= 0 ? 'pos' : 'neg-r'}">${M.fmt(m.resultadoCasa)}</b></div>
      <div><span>Volumen emparejado</span><b>${M.fmt(m.volumen)}</b></div>
      <div><span>Emparejamiento</span><b>${pct(m.tasaEmparejamiento)}</b></div>
      <div><span>En custodia</span><b>${M.fmt(m.enEscrow)}</b></div>
      <div><span>Libro cuadra</span><b class="${m.cuadra ? 'pos' : 'neg-r'}">${m.cuadra ? 'Sí ✓' : 'NO ✗'}</b></div>
    </div>

    <h2 class="sec-titulo">Alertas de fraude <span class="contador">${alertas.length}</span></h2>
    ${alertas.map((a) => `<div class="tarjeta alerta alerta-${a.nivel}"><b>${esc(a.tipo.replace(/_/g, ' '))}</b><div>${esc(a.texto)}</div></div>`).join('') || '<p class="vacio">Sin alertas.</p>'}

    <h2 class="sec-titulo">Retiros por revisar <span class="contador">${retiros.length}</span></h2>
    ${retiros.map((r) => `<div class="tarjeta admin-ev">
      <div><b>${nombre(r.usuarioId)}</b> retira ${M.fmt(r.monto)} → ${M.fmt(r.neto)} a ···${esc(r.clabe.slice(-4))}<div class="sub">${fechaCorta(r.creado)}${r.revisionManual ? ' · monto alto' : ''}</div></div>
      <div class="fila-btn"><button class="btn btn-chico" data-accion="aprobar-ret" data-id="${r.id}">Aprobar y pagar</button><button class="btn btn-chico btn-fantasma" data-accion="rechazar-ret" data-id="${r.id}">Rechazar</button></div>
    </div>`).join('') || '<p class="vacio">Nada por revisar.</p>'}

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
      <label>Liga<input id="ev-liga" name="liga" required placeholder="Liga MX"></label>
      <label>Opción A<input id="ev-a" name="a" required placeholder="Equipo local"></label>
      <label>Opción B<input id="ev-b" name="b" required placeholder="Equipo visitante"></label>
      <label>Probabilidad de A según el mercado (%)<input id="ev-p" name="p" type="number" min="1" max="99" placeholder="50"></label>
      <label>Fecha y hora<input id="ev-inicia" name="inicia" type="datetime-local" required></label>
      <button class="btn btn-primario">Crear evento</button>
    </form>

    <h2 class="sec-titulo">Bitácora de acciones</h2>
    <ul class="movs">${estado.bitacora.slice(-10).reverse().map((b) => `<li><div><b>${esc(b.accion.replace(/_/g, ' '))}</b><span class="sub">${nombre(b.actorId)} · ${fechaCorta(b.fecha)}</span></div></li>`).join('') || '<li class="sub">Sin acciones todavía.</li>'}</ul>
  </main>`;
};

vistas.noEncontrado = () => `${encabezado('', true)}<main><p class="vacio">No encontramos eso.</p><a class="btn btn-primario" href="#/inicio">Ir al inicio</a></main>`;

// ---------- Router ----------
const usuariosReales = () => Object.values(estado.usuarios).filter((u) => !estado.demo?.bots.includes(u.id));
function render(arriba = false) {
  const [, ruta = 'inicio', param] = location.hash.split('/');
  if (!yoId && !['bienvenida', 'cuentas'].includes(ruta)) {
    if (ruta === 'reto' && param) { try { sessionStorage.setItem('duelo_destino', location.hash); } catch {} }
    return ir('/bienvenida');
  }
  if (yoId && ruta === 'bienvenida') return ir('/inicio');
  const vista = vistas[ruta] || vistas.noEncontrado;
  $app.innerHTML = vista(param);
  if (arriba) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => render(true));

function entrar(id) {
  yoId = id; A.sesion.set(id);
  let destino = null;
  try { destino = sessionStorage.getItem('duelo_destino'); sessionStorage.removeItem('duelo_destino'); } catch {}
  ir(destino ? destino.slice(1) : '/inicio');
}
function salir() { yoId = null; A.sesion.set(null); ir('/bienvenida'); }

// Cierre de sesión por inactividad.
const MINUTOS_INACTIVIDAD = 15;
let ultimaActividad = Date.now();
['click', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true }));
setInterval(() => {
  if (yoId && Date.now() - ultimaActividad > MINUTOS_INACTIVIDAD * 60e3) { salir(); toast('Cerramos tu sesión por inactividad'); }
}, 30e3);

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
    const p = Number(f.get('p'));
    const ok = operar(() => M.crearEvento(estado, {
      titulo: `${f.get('a')} vs ${f.get('b')}`, liga: f.get('liga'), opciones: [f.get('a'), f.get('b')],
      inicia: new Date(f.get('inicia')).toISOString(), probabilidades: p > 0 && p < 100 ? [p, 100 - p] : null,
    }, yoId), 'Evento creado');
    if (ok) render();
  }
});

const CAMPOS = {
  monto: (v) => { borrador.monto = v; },
  rival: (v) => { borrador.rival = v; },
  privado: (v, el) => { borrador.privado = el.checked; },
  'dep-monto': (v) => { depBorrador.monto = v; },
  'ret-monto': (v) => { retBorrador.monto = v; },
  'ret-clabe': (v) => { retBorrador.clabe = v.replace(/\D/g, '').slice(0, 18); },
};
$app.addEventListener('input', (ev) => {
  const c = ev.target.dataset.campo;
  if (!c || !CAMPOS[c]) return;
  CAMPOS[c](ev.target.value, ev.target);
  if (c === 'privado') return;
  // re-render conservando el foco y el cursor del campo
  const pos = ev.target.selectionStart;
  render();
  const nuevo = $app.querySelector(`[data-campo="${c}"]`);
  if (nuevo) { nuevo.focus(); try { nuevo.setSelectionRange(pos, pos); } catch {} }
});

$app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-accion]');
  if (!el) return;
  const { accion, id, v } = el.dataset;
  switch (accion) {
    case 'atras': history.length > 1 ? history.back() : ir('/inicio'); break;
    case 'lado': borrador.lado = +v; render(); break;
    case 'monto': borrador.monto = +v; render(); break;
    case 'modo': borrador.modo = v; render(); break;
    case 'ratio': borrador.rival = Math.round(+borrador.monto * +v); render(); break;
    case 'pestana': pestanaMisRetos = v; render(); break;
    case 'publicar': {
      const b = borrador;
      const r = operar(() => M.crearReto(estado, {
        creadorId: yoId, eventoId: b.eventoId, lado: b.lado, privado: b.privado,
        monto: M.aCentavos(b.monto), montoRival: M.aCentavos(b.rival),
      }), 'Reto publicado. Tu dinero está en custodia.');
      if (r) { borrador = null; ir(`/reto/${r.id}`); }
      break;
    }
    case 'aceptar': {
      const r = estado.retos[id];
      const okk = await preguntar(`¿Aceptar el reto por ${M.fmt(r.montoRival)}?`, {
        ok: 'Acepto el compromiso',
        detalle: `Al aceptar, tu dinero queda comprometido en custodia hasta el resultado oficial y <b>ya no se puede cancelar</b>. Si ganas recibes ${M.fmt(M.pagoSiGana(r.montoRival, r.monto))}.`,
      });
      if (okk && operar(() => M.aceptarReto(estado, id, yoId), '¡Compromiso cerrado! Que gane el mejor.')) render();
      break;
    }
    case 'cancelar': if (await preguntar('¿Cancelar el reto? Recuperas tu dinero completo.', { ok: 'Cancelar reto', peligro: true }) && operar(() => M.cancelarReto(estado, id, yoId), 'Reto cancelado')) render(); break;
    case 'compartir': {
      const r = estado.retos[id]; const e = estado.eventos[r.eventoId];
      const url = `${location.origin}${location.pathname}#/reto/${id}`;
      const texto = `Te reto: ${e.titulo}. Yo voy con ${e.opciones[r.lado]} y pongo ${M.fmt(r.monto)}; tú pones ${M.fmt(r.montoRival)} y si ganas te llevas ${M.fmt(M.pagoSiGana(r.montoRival, r.monto))}.`;
      try {
        if (navigator.share) await navigator.share({ title: MARCA.nombre, text: texto, url });
        else { await navigator.clipboard.writeText(`${texto} ${url}`); toast('Link copiado'); }
      } catch { toast('No se pudo compartir; copia el link desde la barra del navegador', 'error'); }
      break;
    }
    case 'dep-monto': depBorrador.monto = +v; render(); break;
    case 'dep-metodo': depBorrador.metodo = v; render(); break;
    case 'dep-continuar': {
      const d = operar(() => M.iniciarDeposito(estado, yoId, M.aCentavos(depBorrador.monto), depBorrador.metodo));
      if (d) ir(`/deposito/${d.id}`);
      break;
    }
    case 'dep-simular': {
      // Demo: simula la notificación firmada del procesador.
      if (operar(() => M.confirmarDeposito(estado, id, `demo_${id}`), 'Depósito acreditado a tu saldo')) render();
      break;
    }
    case 'ret-todo': retBorrador.monto = String(M.saldoUsuario(estado, yoId) / 100); render(); break;
    case 'ret-solicitar': {
      const monto = M.aCentavos(retBorrador.monto);
      const ok = await preguntar(`¿Retirar ${M.fmt(monto)}?`, { ok: 'Solicitar retiro', detalle: `Comisión ${M.fmt(M.comisionRetiro(monto))}. Llegan ${M.fmt(monto - M.comisionRetiro(monto))} a la CLABE ···${esc(retBorrador.clabe.slice(-4))}.` });
      if (ok && operar(() => M.solicitarRetiro(estado, yoId, monto, retBorrador.clabe), 'Retiro en revisión de seguridad')) { retBorrador = { monto: '', clabe: '' }; ir('/billetera'); }
      break;
    }
    case 'aprobar-ret': if (operar(() => M.aprobarRetiro(estado, id, yoId), 'Retiro pagado')) render(); break;
    case 'rechazar-ret': if (await preguntar('¿Rechazar este retiro?', { ok: 'Rechazar', peligro: true, detalle: 'Se le devuelve al usuario el monto y la comisión.' }) && operar(() => M.rechazarRetiro(estado, id, yoId, 'Rechazado por revisión de seguridad'), 'Retiro rechazado y devuelto')) render(); break;
    case 'cerrar-ev': if (operar(() => M.cerrarEvento(estado, id, yoId), 'Apuestas cerradas para este evento')) render(); break;
    case 'resolver': {
      const e = estado.eventos[id];
      const txt = v === 'anulado' ? 'ANULAR (se devuelve todo)' : `ganó ${e.opciones[+v]}`;
      if (!(await preguntar(`${e.titulo} → ${txt}`, { ok: 'Resolver', detalle: 'Paga a los ganadores y no se puede deshacer. Queda registrado en la bitácora.' }))) break;
      const res = operar(() => M.resolverEvento(estado, id, v === 'anulado' ? 'anulado' : +v, yoId));
      if (res) { toast(`${res.liquidados} liquidados, ${res.reembolsados} reembolsados · comisión ${M.fmt(res.comisionTotal)}`); render(); }
      break;
    }
    case 'autoexcluir':
      if (await preguntar('¿Pausar tu cuenta 7 días?', { ok: 'Pausar', peligro: true, detalle: 'No podrás apostar ni depositar durante la pausa. No se puede revertir antes de tiempo.' })
        && operar(() => M.autoexcluir(estado, yoId, 7), 'Cuenta en pausa por 7 días')) ir('/perfil');
      break;
    case 'elegir-cuenta': ir('/cuentas'); break;
    case 'entrar-como': entrar(id); break;
    case 'nueva-cuenta': salir(); break;
    case 'salir': salir(); break;
    case 'reiniciar':
      if (await preguntar('Esto borra todas las cuentas y retos demo de este dispositivo.', { ok: 'Borrar todo', peligro: true })) { A.reiniciar(); location.hash = ''; location.reload(); }
      break;
  }
});

render(true);
