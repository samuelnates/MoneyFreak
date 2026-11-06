-- =====================================================================
-- Apuestas 1v1 — esquema base para Supabase (Postgres 15+)
-- Mismas reglas que web/js/motor.js, pero aquí son la fuente de verdad.
-- Regla de oro: el cliente NUNCA escribe tablas de dinero directo; todo
-- pasa por funciones RPC transaccionales con bloqueo de filas.
-- Montos en centavos (bigint).
-- =====================================================================

create table public.config (
  id boolean primary key default true check (id),
  tasa_comision numeric(5,4) not null default 0.05,
  apuesta_minima bigint not null default 1000,
  apuesta_maxima bigint not null default 500000,
  bono_bienvenida bigint not null default 100000,   -- 0 cuando sea dinero real
  modo_dinero text not null default 'demo' check (modo_dinero in ('demo','real'))
);
insert into public.config default values;

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 30),
  es_admin boolean not null default false,
  fecha_nacimiento date,
  kyc_estado text not null default 'pendiente' check (kyc_estado in ('pendiente','verificado','rechazado')),
  autoexcluido_hasta timestamptz,
  creado timestamptz not null default now()
);

-- Saldo disponible cacheado (fuente de verdad = líneas del libro mayor).
-- El CHECK hace imposible un saldo negativo aunque haya un bug.
create table public.billeteras (
  usuario_id uuid primary key references public.perfiles(id) on delete cascade,
  saldo bigint not null default 0 check (saldo >= 0)
);

create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  liga text not null default 'Otro',
  opcion_a text not null,
  opcion_b text not null,
  inicia timestamptz not null,
  estado text not null default 'abierto' check (estado in ('abierto','cerrado','resuelto','anulado')),
  resultado smallint check (resultado in (0,1)),
  proveedor_id text,             -- id en el feed de resultados (API deportiva)
  creado timestamptz not null default now()
);

create table public.retos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id),
  creador_id uuid not null references public.perfiles(id),
  lado smallint not null check (lado in (0,1)),
  monto bigint not null check (monto > 0),
  monto_rival bigint not null check (monto_rival > 0),
  privado boolean not null default false,
  rival_id uuid references public.perfiles(id),
  estado text not null default 'abierto'
    check (estado in ('abierto','emparejado','liquidado','cancelado','expirado','anulado')),
  ganador_id uuid references public.perfiles(id),
  comision bigint not null default 0,
  creado timestamptz not null default now(),
  check (rival_id is null or rival_id <> creador_id)
);
create index on public.retos (evento_id, estado);
create index on public.retos (creador_id);
create index on public.retos (rival_id);

-- Libro mayor de partida doble (append-only).
create table public.asientos (
  id bigint generated always as identity primary key,
  tipo text not null,
  reto_id uuid references public.retos(id),
  creado timestamptz not null default now()
);
create table public.lineas (
  id bigint generated always as identity primary key,
  asiento_id bigint not null references public.asientos(id),
  cuenta text not null,          -- 'u:<uuid>' | 'escrow' | 'casa' | 'externo'
  monto bigint not null
);
create index on public.lineas (cuenta);

-- ---------------------------------------------------------------------
-- Núcleo contable
-- ---------------------------------------------------------------------
create or replace function public._asentar(p_tipo text, p_reto uuid, p_lineas jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_asiento bigint; v_l jsonb; v_suma bigint := 0;
begin
  select coalesce(sum((l->>'monto')::bigint), 0) into v_suma from jsonb_array_elements(p_lineas) l;
  if v_suma <> 0 then raise exception 'Asiento descuadrado (%)', v_suma; end if;
  insert into asientos (tipo, reto_id) values (p_tipo, p_reto) returning id into v_asiento;
  for v_l in select * from jsonb_array_elements(p_lineas) loop
    insert into lineas (asiento_id, cuenta, monto) values (v_asiento, v_l->>'cuenta', (v_l->>'monto')::bigint);
    if v_l->>'cuenta' like 'u:%' then
      update billeteras set saldo = saldo + (v_l->>'monto')::bigint
       where usuario_id = substr(v_l->>'cuenta', 3)::uuid;
      if not found then raise exception 'Billetera inexistente'; end if;
    end if;
  end loop;
  return v_asiento;
end $$;
revoke all on function public._asentar(text, uuid, jsonb) from public, anon, authenticated;

create or replace function public._linea(p_cuenta text, p_monto bigint)
returns jsonb language sql immutable as $$ select jsonb_build_object('cuenta', p_cuenta, 'monto', p_monto) $$;

-- Alta automática: perfil + billetera + bono demo al registrarse en Auth.
create or replace function public._nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bono bigint;
begin
  insert into perfiles (id, nombre)
    values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1), 'Jugador'));
  insert into billeteras (usuario_id) values (new.id);
  select bono_bienvenida into v_bono from config;
  if v_bono > 0 then
    perform _asentar('bono', null, jsonb_build_array(_linea('externo', -v_bono), _linea('u:' || new.id, v_bono)));
  end if;
  return new;
end $$;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public._nuevo_usuario();

-- ---------------------------------------------------------------------
-- RPCs públicas (supabase.rpc('crear_reto', {...}))
-- ---------------------------------------------------------------------
create or replace function public.crear_reto(p_evento uuid, p_lado smallint, p_monto bigint,
  p_monto_rival bigint default null, p_privado boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare c config; v_yo uuid := auth.uid(); v_ev eventos; v_saldo bigint; v_id uuid;
begin
  if v_yo is null then raise exception 'Inicia sesión'; end if;
  select * into c from config;
  p_monto_rival := coalesce(p_monto_rival, p_monto);
  if least(p_monto, p_monto_rival) < c.apuesta_minima then raise exception 'Apuesta menor a la mínima'; end if;
  if greatest(p_monto, p_monto_rival) > c.apuesta_maxima then raise exception 'Apuesta mayor a la máxima'; end if;
  select * into v_ev from eventos where id = p_evento for share;
  if v_ev.id is null or v_ev.estado <> 'abierto' or v_ev.inicia <= now() then raise exception 'El evento ya no acepta retos'; end if;
  select saldo into v_saldo from billeteras where usuario_id = v_yo for update;
  if v_saldo < p_monto then raise exception 'Saldo insuficiente'; end if;
  insert into retos (evento_id, creador_id, lado, monto, monto_rival, privado)
    values (p_evento, v_yo, p_lado, p_monto, p_monto_rival, p_privado) returning id into v_id;
  perform _asentar('bloqueo', v_id, jsonb_build_array(_linea('u:' || v_yo, -p_monto), _linea('escrow', p_monto)));
  return v_id;
end $$;

create or replace function public.aceptar_reto(p_reto uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_yo uuid := auth.uid(); r retos; v_ev eventos; v_saldo bigint;
begin
  if v_yo is null then raise exception 'Inicia sesión'; end if;
  select * into r from retos where id = p_reto for update;          -- evita doble aceptación
  if r.id is null or r.estado <> 'abierto' then raise exception 'Este reto ya no está disponible'; end if;
  if r.creador_id = v_yo then raise exception 'No puedes aceptar tu propio reto'; end if;
  select * into v_ev from eventos where id = r.evento_id;
  if v_ev.estado <> 'abierto' or v_ev.inicia <= now() then raise exception 'El evento ya empezó'; end if;
  select saldo into v_saldo from billeteras where usuario_id = v_yo for update;
  if v_saldo < r.monto_rival then raise exception 'Saldo insuficiente'; end if;
  perform _asentar('bloqueo', r.id, jsonb_build_array(_linea('u:' || v_yo, -r.monto_rival), _linea('escrow', r.monto_rival)));
  update retos set rival_id = v_yo, estado = 'emparejado' where id = r.id;
end $$;

create or replace function public._reembolsar(r retos, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb := jsonb_build_array(_linea('u:' || r.creador_id, r.monto));
        v_total bigint := r.monto;
begin
  if r.rival_id is not null then
    v := v || jsonb_build_array(_linea('u:' || r.rival_id, r.monto_rival)); v_total := v_total + r.monto_rival;
  end if;
  perform _asentar('reembolso', r.id, v || jsonb_build_array(_linea('escrow', -v_total)));
  update retos set estado = p_estado where id = r.id;
end $$;
revoke all on function public._reembolsar(retos, text) from public, anon, authenticated;

create or replace function public.cancelar_reto(p_reto uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r retos;
begin
  select * into r from retos where id = p_reto for update;
  if r.id is null or r.creador_id is distinct from auth.uid() then raise exception 'Solo quien creó el reto puede cancelarlo'; end if;
  if r.estado <> 'abierto' then raise exception 'Solo se cancelan retos que nadie ha aceptado'; end if;
  perform _reembolsar(r, 'cancelado');
end $$;

-- p_resultado: '0' | '1' | 'anulado'. Solo admins (o un job con service_role).
create or replace function public.resolver_evento(p_evento uuid, p_resultado text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c config; v_ev eventos; r retos; v_bote bigint; v_com bigint; v_gan uuid;
        v_liq int := 0; v_reem int := 0; v_com_total bigint := 0;
begin
  if auth.uid() is not null and not exists (select 1 from perfiles where id = auth.uid() and es_admin) then
    raise exception 'Solo administradores';
  end if;
  if p_resultado not in ('0','1','anulado') then raise exception 'Resultado inválido'; end if;
  select * into c from config;
  select * into v_ev from eventos where id = p_evento for update;
  if v_ev.id is null or v_ev.estado in ('resuelto','anulado') then raise exception 'El evento ya se resolvió'; end if;

  for r in select * from retos where evento_id = p_evento and estado in ('abierto','emparejado') for update loop
    if r.estado = 'abierto' then perform _reembolsar(r, 'expirado'); v_reem := v_reem + 1; continue; end if;
    if p_resultado = 'anulado' then perform _reembolsar(r, 'anulado'); v_reem := v_reem + 1; continue; end if;
    v_bote := r.monto + r.monto_rival;
    v_com := round(v_bote * c.tasa_comision);
    v_gan := case when p_resultado::smallint = r.lado then r.creador_id else r.rival_id end;
    perform _asentar('liquidacion', r.id, jsonb_build_array(
      _linea('escrow', -v_bote), _linea('u:' || v_gan, v_bote - v_com), _linea('casa', v_com)));
    update retos set estado = 'liquidado', ganador_id = v_gan, comision = v_com where id = r.id;
    v_liq := v_liq + 1; v_com_total := v_com_total + v_com;
  end loop;

  update eventos set estado = case when p_resultado = 'anulado' then 'anulado' else 'resuelto' end,
                     resultado = case when p_resultado = 'anulado' then null else p_resultado::smallint end
   where id = p_evento;
  return jsonb_build_object('liquidados', v_liq, 'reembolsados', v_reem, 'comision', v_com_total);
end $$;

-- Para abrir un reto privado desde su link sin exponer los demás.
create or replace function public.ver_reto(p_reto uuid)
returns setof retos language sql security definer set search_path = public stable as $$
  select * from retos where id = p_reto and auth.uid() is not null
$$;

-- Auditoría: debe regresar 0 siempre. Monitorearlo con una alerta.
create or replace view public.auditoria_cuadre with (security_invoker = true) as
  select (select coalesce(sum(monto), 0) from lineas) as suma_global,
         (select coalesce(sum(monto), 0) from lineas where cuenta = 'escrow') as escrow,
         (select coalesce(sum(monto), 0) from lineas where cuenta = 'casa') as ingresos_casa,
         (select coalesce(sum(saldo), 0) from billeteras)
           - (select coalesce(sum(monto), 0) from lineas where cuenta like 'u:%') as diferencia_cache;

-- ---------------------------------------------------------------------
-- Row Level Security: lectura acotada, CERO escritura directa.
-- ---------------------------------------------------------------------
alter table public.config     enable row level security;
alter table public.perfiles   enable row level security;
alter table public.billeteras enable row level security;
alter table public.eventos    enable row level security;
alter table public.retos      enable row level security;
alter table public.asientos   enable row level security;
alter table public.lineas     enable row level security;

create policy "config visible" on public.config for select using (true);
create policy "perfiles visibles" on public.perfiles for select to authenticated using (true);
create policy "mi billetera" on public.billeteras for select to authenticated using (usuario_id = auth.uid());
create policy "eventos visibles" on public.eventos for select using (true);
create policy "retos públicos o míos" on public.retos for select to authenticated
  using (not privado or creador_id = auth.uid() or rival_id = auth.uid());
create policy "mis líneas" on public.lineas for select to authenticated using (cuenta = 'u:' || auth.uid());
create policy "mis asientos" on public.asientos for select to authenticated
  using (exists (select 1 from lineas l where l.asiento_id = asientos.id and l.cuenta = 'u:' || auth.uid()));
create policy "admin crea eventos" on public.eventos for insert to authenticated
  with check (exists (select 1 from perfiles where id = auth.uid() and es_admin));
-- Sin policy de UPDATE a propósito: cambiar el estado de un evento a mano
-- podría dejar dinero atorado en escrow. Se cierra/resuelve solo por RPC.
create or replace function public.cerrar_evento(p_evento uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not exists (select 1 from perfiles where id = auth.uid() and es_admin) then
    raise exception 'Solo administradores';
  end if;
  update eventos set estado = 'cerrado' where id = p_evento and estado = 'abierto';
  if not found then raise exception 'El evento no está abierto'; end if;
end $$;
