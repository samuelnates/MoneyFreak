alter table public.solicitudes_gasto_pendientes
  add column if not exists es_compra_meses boolean not null default false;

alter table public.solicitudes_gasto_pendientes
  add column if not exists es_recurrente boolean not null default false;

alter table public.solicitudes_gasto_pendientes
  add column if not exists meses_sugeridos int;
