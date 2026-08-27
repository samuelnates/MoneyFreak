-- Registro propio de errores/crasheos de la app (reemplaza a Sentry, que
-- nunca se terminó de configurar -- el usuario no pudo registrarse en su
-- portal). Cualquiera puede insertar (hay errores antes de iniciar sesión,
-- ej. en la pantalla de login), pero nadie puede leer las filas de nadie
-- desde el cliente: solo se leen agregadas, con service role, desde la
-- Edge Function panel-admin-kpis.

create table if not exists public.errores_app (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  mensaje text not null,
  stack text,
  url text,
  user_agent text,
  creado_en timestamptz not null default now()
);

alter table public.errores_app enable row level security;

create policy "errores_app_insertar_cualquiera"
  on public.errores_app for insert
  to public
  with check (true);

create index if not exists errores_app_creado_en_idx
  on public.errores_app (creado_en desc);
