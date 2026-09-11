-- Fondos compartidos: dinero que llega de varias personas para un mismo
-- gasto recurrente (beca repartida entre familiares, renta compartida,
-- pensión) -- llevar quién aporta cuánto y avisarle a cada quien.
--
-- fondos_compartidos: el fondo en sí (meta mensual + configuración del
-- recordatorio). fondos_aportantes: cada persona/fuente que contribuye, con
-- su tipo de aporte (fijo / porcentaje de la meta / cubre el resto -- solo
-- puede haber uno tipo 'resto' por fondo, se valida en el cliente igual que
-- el resto de las reglas de negocio de esta app). fondos_confirmaciones:
-- mismo patrón que flujo_cumplido -- "este aportante ya depositó este
-- mes/año", se resetea solo porque solo se consulta el periodo actual, sin
-- necesidad de ningún job de limpieza.

create table if not exists fondos_compartidos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null,
  meta_mensual numeric not null check (meta_mensual >= 0),
  dia_limite int not null default 28 check (dia_limite between 1 and 28),
  dias_aviso int not null default 3 check (dias_aviso between 1 and 15),
  creado_en timestamptz not null default now()
);
create index if not exists idx_fondos_compartidos_user on fondos_compartidos(user_id);

alter table fondos_compartidos enable row level security;
create policy "fondos_compartidos_owner_all" on fondos_compartidos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fondos_compartidos_demo_select" on fondos_compartidos
  for select using (user_id = '425f88c2-1ee1-4f86-ba61-8cd52e055ed3'::uuid);

create table if not exists fondos_aportantes (
  id uuid primary key default gen_random_uuid(),
  fondo_id uuid not null references fondos_compartidos(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null,
  tipo text not null check (tipo in ('fijo', 'porcentaje', 'resto')),
  valor numeric, -- monto fijo o % según `tipo`; null cuando tipo = 'resto'
  telefono text,
  orden int not null default 0,
  creado_en timestamptz not null default now()
);
create index if not exists idx_fondos_aportantes_fondo on fondos_aportantes(fondo_id, orden);

alter table fondos_aportantes enable row level security;
create policy "fondos_aportantes_owner_all" on fondos_aportantes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fondos_aportantes_demo_select" on fondos_aportantes
  for select using (user_id = '425f88c2-1ee1-4f86-ba61-8cd52e055ed3'::uuid);

create table if not exists fondos_confirmaciones (
  id uuid primary key default gen_random_uuid(),
  aportante_id uuid not null references fondos_aportantes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  creado_en timestamptz not null default now(),
  unique (aportante_id, anio, mes)
);

alter table fondos_confirmaciones enable row level security;
create policy "fondos_confirmaciones_owner_all" on fondos_confirmaciones
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "fondos_confirmaciones_demo_select" on fondos_confirmaciones
  for select using (user_id = '425f88c2-1ee1-4f86-ba61-8cd52e055ed3'::uuid);
