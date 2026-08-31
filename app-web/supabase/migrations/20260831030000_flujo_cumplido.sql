-- Parte 109: "a veces te pagan antes / pagas antes" en Flujo de efectivo.
-- El flujo proyecta ingresos/deudas/aportaciones recurrentes por su día del
-- mes, sin saber si ese movimiento YA ocurrió este ciclo -- si ya te
-- pagaron antes de la fecha esperada, el dinero real ya está en tu cuenta,
-- pero el flujo lo seguía sumando OTRA VEZ como si fuera a pasar (doble
-- conteo). Esta tabla guarda, por ítem y por mes/año, que el usuario marcó
-- "ya se cumplió este mes" a mano -- se resetea sola cada mes porque solo
-- se consulta por el mes/año actual, sin necesidad de ningún job de limpieza.
create table if not exists flujo_cumplido (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('deuda', 'aportacion', 'ingreso')),
  ref_id uuid not null,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  creado_en timestamptz not null default now(),
  unique (user_id, tipo, ref_id, anio, mes)
);

alter table flujo_cumplido enable row level security;

create policy "flujo_cumplido_owner_all" on flujo_cumplido
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Mismo patrón de acceso público de solo-lectura para la cuenta de muestra
-- (verMuestra()) que ya usan ingresos/cuentas/etc.
create policy "flujo_cumplido_demo_select" on flujo_cumplido
  for select using (user_id = '425f88c2-1ee1-4f86-ba61-8cd52e055ed3'::uuid);
