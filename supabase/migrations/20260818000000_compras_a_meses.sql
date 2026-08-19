-- Compras a meses: vincula gastos programados a futuro con la deuda que
-- representan, para poder ir reduciendo esa deuda automáticamente conforme
-- se van "cumpliendo" los pagos (sin necesidad de un cron: se revisa cada
-- vez que se abre la app, ver aplicarComprasMesesVencidas() en el cliente).

alter table public.gastos
  add column if not exists compra_meses_deuda_id uuid references public.deudas(id) on delete set null;

alter table public.gastos
  add column if not exists compra_meses_aplicado boolean not null default false;

create index if not exists gastos_compra_meses_pendientes_idx
  on public.gastos (compra_meses_deuda_id, fecha)
  where compra_meses_deuda_id is not null and compra_meses_aplicado = false;
