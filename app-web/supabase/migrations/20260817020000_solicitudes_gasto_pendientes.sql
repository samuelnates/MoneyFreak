-- Cola de solicitudes de gasto capturadas por voz o foto, pendientes de que
-- el usuario las apruebe (o rechace) antes de que se conviertan en un gasto
-- real. El usuario lee/escribe su propia fila directo (como en `gastos`);
-- solo el INSERT inicial lo hace la Edge Function `procesar-solicitud-gasto`
-- con service role, porque cada inserción implica una llamada pagada a OpenAI.

create table if not exists public.solicitudes_gasto_pendientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null, -- 'audio' | 'foto'
  estado text not null default 'pendiente', -- 'pendiente' | 'aprobado' | 'rechazado'
  monto_sugerido numeric,
  categoria_sugerida text,
  subcategoria_sugerida text,
  nota_sugerida text,
  fecha_sugerida date,
  texto_fuente text,
  confianza text, -- 'alta' | 'media' | 'baja'
  creado_en timestamptz not null default now()
);

alter table public.solicitudes_gasto_pendientes enable row level security;

create policy "solicitudes_gasto_select_propio"
  on public.solicitudes_gasto_pendientes for select
  using (auth.uid() = user_id);

create policy "solicitudes_gasto_update_propio"
  on public.solicitudes_gasto_pendientes for update
  using (auth.uid() = user_id);

create policy "solicitudes_gasto_delete_propio"
  on public.solicitudes_gasto_pendientes for delete
  using (auth.uid() = user_id);

create index if not exists solicitudes_gasto_pendientes_user_estado_idx
  on public.solicitudes_gasto_pendientes (user_id, estado, creado_en desc);
