-- Tier 1: radiografía financiera automática (Money Freak)
-- Tabla que guarda cada reporte generado por la Edge Function `radiografia-mensual`.

create table if not exists public.reportes_financieros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_month date not null, -- siempre el día 1 del mes del reporte, ej. '2026-08-01'
  report_version int not null default 1,
  schema_version text not null default '1.0',
  prompt_version text not null default '1.0',
  status text not null default 'completed', -- 'completed' | 'error'
  model text,
  input_tokens int,
  cached_input_tokens int,
  output_tokens int,
  report_json jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  unique (user_id, report_month, report_version)
);

alter table public.reportes_financieros enable row level security;

-- Cada usuario solo puede leer sus propios reportes.
create policy "reportes_financieros_select_propio"
  on public.reportes_financieros
  for select
  using (auth.uid() = user_id);

-- Los inserts/updates SOLO los hace la Edge Function con la service role key,
-- que ignora RLS por diseño de Supabase — no se agregan políticas de insert/update
-- para el rol authenticated a propósito (el cliente nunca escribe esta tabla directo).

create index if not exists reportes_financieros_user_mes_idx
  on public.reportes_financieros (user_id, report_month desc);
