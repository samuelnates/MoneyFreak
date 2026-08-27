-- Registro de negocio de Money Freak (no confundir con las finanzas
-- personales de los usuarios): lo que el dueño lleva invertido, sus gastos
-- operativos recurrentes (App Store, Google Play, dominio, IA, etc.) y sus
-- ingresos (publicidad/suscripciones, cuando existan). Vive completamente
-- aparte de las tablas de usuarios -- no tiene columna user_id porque no es
-- de ningún usuario, es del negocio.
--
-- RLS habilitado SIN ninguna policy a propósito: nadie con la llave anon o
-- authenticated puede tocar esta tabla ni para leer ni para escribir, pase
-- lo que pase. Solo la Edge Function negocio-movimientos (service role,
-- mismo candado de correo admin que panel-admin-kpis) puede leerla o
-- escribirla -- bypassa RLS por diseño, así que no hace falta ninguna
-- policy para el flujo normal.

create table if not exists public.negocio_movimientos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  tipo text not null, -- 'ingreso' | 'gasto' | 'inversion'
  categoria text not null,
  concepto text,
  monto numeric not null,
  moneda text not null default 'USD',
  es_recurrente boolean not null default false,
  creado_en timestamptz not null default now()
);

alter table public.negocio_movimientos enable row level security;

create index if not exists negocio_movimientos_fecha_idx
  on public.negocio_movimientos (fecha desc);
