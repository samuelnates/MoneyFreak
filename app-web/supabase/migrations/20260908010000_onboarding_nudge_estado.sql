-- Parte 202: seguimiento de los recordatorios push de "primeros pasos" para
-- cuentas nuevas que siguen sin capturar nada (revisar-onboarding-inactivo).
-- Una fila por usuario, para no mandar el mismo aviso más de una vez aunque
-- el cron corra varias veces mientras la cuenta sigue vacía.
create table if not exists public.onboarding_nudge_estado (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dia1_enviado boolean not null default false,
  dia3_enviado boolean not null default false,
  actualizado_en timestamptz not null default now()
);

-- Solo la service role (la Edge Function) la toca -- sin políticas de RLS
-- para el cliente, mismo patrón que alertas_presupuesto_estado.
alter table public.onboarding_nudge_estado enable row level security;
