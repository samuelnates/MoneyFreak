alter table public.solicitudes_gasto_pendientes
  add column if not exists medio_pago_sugerido text;
