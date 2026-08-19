-- Control de acceso y costo para la radiografía financiera automática (OpenAI).
-- Dos tablas, ninguna con policies para authenticated/anon a propósito:
-- todo el acceso pasa por las Edge Functions con la service role key, que
-- ignora RLS por diseño. El cliente nunca lee ni escribe estas tablas directo.

create table if not exists public.codigos_acceso_ia (
  codigo text primary key,
  usos_maximos int, -- null = sin límite de canjes
  usos_actuales int not null default 0,
  activo boolean not null default true,
  nota text, -- para qué/quién es este código, uso tuyo, no se muestra al usuario
  creado_en timestamptz not null default now()
);

create table if not exists public.accesos_ia_usuarios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  codigo text not null references public.codigos_acceso_ia(codigo),
  redimido_en timestamptz not null default now()
);

alter table public.codigos_acceso_ia enable row level security;
alter table public.accesos_ia_usuarios enable row level security;

-- Código inicial para que tú mismo puedas seguir usando la función después
-- de este cambio (antes de esto nadie tiene acceso porque la tabla está vacía).
-- Cámbialo o agrega más códigos cuando quieras, es solo una fila de esta tabla.
insert into public.codigos_acceso_ia (codigo, usos_maximos, nota)
values ('MFBETA-2026', null, 'código general de beta, sin límite de usos')
on conflict (codigo) do nothing;
