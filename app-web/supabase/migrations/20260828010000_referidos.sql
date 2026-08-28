-- Sistema de "invita a un amigo": cada usuario tiene un código propio para
-- compartir. Cuando alguien se registra con ese código Y de verdad usa la
-- app (agrega su primera cuenta o gasto -- no solo instalarla), cuenta como
-- "activado". A cierto número de activados se desbloquean recompensas
-- (avatares nuevos de Freaky y, al llegar a 5, sin_anuncios). Ver Edge
-- Function `referidos` para la lógica de lectura/canje -- esta tabla no
-- tiene ninguna policy de RLS para clientes, mismo patrón que
-- negocio_movimientos: solo el service role la toca.

create table if not exists referidos (
  id uuid primary key default gen_random_uuid(),
  referente_id uuid not null references auth.users(id) on delete cascade,
  referido_id uuid not null unique references auth.users(id) on delete cascade,
  activado boolean not null default false,
  activado_en timestamptz,
  creado_en timestamptz not null default now(),
  constraint referidos_no_auto_referencia check (referente_id <> referido_id)
);
create index if not exists idx_referidos_referente on referidos(referente_id);

alter table referidos enable row level security;
-- Sin policies a propósito -- solo la Edge Function (service role) la toca.

alter table perfil_financiero add column if not exists codigo_referido text unique;
alter table perfil_financiero add column if not exists sin_anuncios boolean not null default false;

-- Código corto (6 caracteres, mayúsculas + dígitos, sin 0/O/1/I para evitar
-- confusión al compartirlo de palabra o por mensaje).
create or replace function generar_codigo_referido() returns text as $$
declare
  alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  codigo text;
  existe boolean;
begin
  loop
    codigo := '';
    for i in 1..6 loop
      codigo := codigo || substr(alfabeto, floor(random() * length(alfabeto) + 1)::int, 1);
    end loop;
    select exists(select 1 from perfil_financiero where codigo_referido = codigo) into existe;
    exit when not existe;
  end loop;
  return codigo;
end;
$$ language plpgsql;

-- Perfiles que ya existen se quedarían sin código si no se hace este backfill
-- una sola vez (los nuevos ya lo reciben solos por el trigger de abajo).
update perfil_financiero set codigo_referido = generar_codigo_referido() where codigo_referido is null;

create or replace function asignar_codigo_referido() returns trigger as $$
begin
  if new.codigo_referido is null then
    new.codigo_referido := generar_codigo_referido();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_asignar_codigo_referido on perfil_financiero;
create trigger trg_asignar_codigo_referido
  before insert on perfil_financiero
  for each row execute function asignar_codigo_referido();

-- Cuando alguien registra su PRIMERA cuenta o PRIMER gasto: si fue referido
-- y todavía no contaba como activado, se marca. Si con eso quien lo invitó
-- llega a 5 referidos activados, se le prende sin_anuncios. Los avatares
-- 4/5/6 no se guardan aparte como "desbloqueado" -- se calculan al vuelo
-- contando activados (ver Edge Function referidos), así nunca se
-- desincroniza el conteo de la recompensa.
-- security definer: necesita tocar filas de OTRO usuario (quien invitó),
-- algo que la sesión del referido no podría hacer bajo su propio RLS.
create or replace function marcar_referido_activado() returns trigger as $$
declare
  v_referente_id uuid;
  v_activados_count int;
begin
  update referidos
    set activado = true, activado_en = now()
    where referido_id = new.user_id and activado = false
    returning referente_id into v_referente_id;

  if v_referente_id is not null then
    select count(*) into v_activados_count
      from referidos where referente_id = v_referente_id and activado = true;
    if v_activados_count >= 5 then
      update perfil_financiero set sin_anuncios = true where user_id = v_referente_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_activar_referido_cuentas on cuentas;
create trigger trg_activar_referido_cuentas
  after insert on cuentas
  for each row execute function marcar_referido_activado();

drop trigger if exists trg_activar_referido_gastos on gastos;
create trigger trg_activar_referido_gastos
  after insert on gastos
  for each row execute function marcar_referido_activado();
