-- Parte 195: caché de la analítica de App Store Connect, para que el panel
-- de admin la muestre instantánea (sin tener que picarle y esperar varias
-- llamadas encadenadas a la API de Apple cada vez). Se llena por cron una
-- vez al día vía la función sync-analitica-apple (net.http_post + pg_cron,
-- mismo patrón ya usado por revisar-alertas-presupuesto).
--
-- Una sola fila (id='actual'): siempre se sobreescribe, no se guarda
-- histórico fila por fila porque los datos de Apple ya vienen agrupados por
-- fecha dentro del jsonb (columna porFecha de cada reporte).
create table if not exists public.analitica_apple_cache (
  id text primary key,
  datos jsonb,
  registros_internos jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz,
  ultimo_intento_en timestamptz not null default now(),
  ultimo_error text
);

-- Solo la service role (usada por las Edge Functions) debe poder leer o
-- escribir esto -- nunca el cliente. RLS activo, sin políticas = sin acceso
-- desde anon/authenticated.
alter table public.analitica_apple_cache enable row level security;
