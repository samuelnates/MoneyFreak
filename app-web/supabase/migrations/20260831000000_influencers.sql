-- Programa de códigos de influencer: un código controlado desde el panel de
-- administración, distinto del código de referido personal de cada usuario
-- (perfil_financiero.codigo_referido). Quien se registra con un código de
-- influencer válido NO entra al programa de referidos normal (no se toca la
-- tabla `referidos`) -- es un programa aparte, curado a mano, pensado para
-- partnerships con creadores de contenido de finanzas: se les da acceso
-- anticipado a la app para que se la "regalen" a sus seguidores, y quien
-- entra con su código se queda con un beneficio real, no solo "entrar antes".
--
-- Mismo patrón de RLS que codigos_acceso_ia / referidos: sin policies para
-- clientes -- solo la Edge Function admin-influencers (service role) la toca.

create table if not exists public.codigos_influencer (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  nombre text not null,
  red_social text,
  contacto text,
  estado text not null default 'activo' check (estado in ('activo', 'pausado')),
  tope_registros int, -- null = sin tope
  nota text,
  creado_en timestamptz not null default now()
);

alter table public.codigos_influencer enable row level security;
-- Sin policies a propósito -- solo la Edge Function admin-influencers.

-- Beneficio de quien se registra con un código de influencer: sin anuncios
-- de por vida (reutiliza la misma columna que ya premia a los referentes
-- que llegan a 5 activados -- el efecto es el mismo, no importa el origen)
-- + un crédito de meses de IA gratis.
--
-- El crédito se guarda como DURACIÓN (ia_gratis_meses), no como fecha de
-- vencimiento fija -- hoy no existe ningún muro de pago para funciones de
-- IA en la app, así que contar el año desde el registro incumpliría la
-- promesa (la persona se quedaría con menos de un año real de beneficio
-- para cuando ese muro exista). El día que se lance un plan de IA de paga
-- es el momento de convertir este crédito en una fecha real
-- (ej. una columna ia_gratis_hasta), no antes.
alter table public.perfil_financiero add column if not exists influencer_codigo text references public.codigos_influencer(codigo);
alter table public.perfil_financiero add column if not exists ia_gratis_meses int;

create index if not exists idx_perfil_influencer_codigo on public.perfil_financiero(influencer_codigo);

-- El campo de "código de invitación" del registro es compartido entre este
-- programa y el de referidos normal (ver Edge Function referidos) -- así que
-- ningún código auto-generado de referido debe poder chocar con uno de
-- influencer ya existente. codigos_influencer.codigo también es unique
-- (arriba), así que un admin no puede crear dos influencers con el mismo
-- código -- pero falta blindar el otro lado: que un código de referido
-- nuevo no se genere igual a uno de influencer ya existente.
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
    select exists(select 1 from perfil_financiero where codigo_referido = codigo)
        or exists(select 1 from codigos_influencer where codigo = codigo)
      into existe;
    exit when not existe;
  end loop;
  return codigo;
end;
$$ language plpgsql;
