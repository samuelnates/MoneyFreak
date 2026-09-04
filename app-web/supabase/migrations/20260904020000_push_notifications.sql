-- Fase 2 del plan de notificaciones (parte 168): infraestructura para push
-- real disparado por el servidor -- a diferencia de las notificaciones
-- locales (programadas por horario, ya existentes), estas SÍ necesitan
-- guardar algo del lado del servidor: el token del dispositivo (para poder
-- mandarle un push) y un pequeño estado de seguimiento (para el colchón de
-- "2 días seguidos antes de avisar" y no repetir el mismo aviso el mismo mes).

-- Un usuario puede tener varios dispositivos (celular + eventualmente otro),
-- así que es user_id -> N tokens, no un campo suelto en perfil_financiero.
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token text not null,
  plataforma text not null, -- 'android' | 'ios'
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.push_tokens enable row level security;

create policy "push_tokens_insertar_propio"
  on public.push_tokens for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "push_tokens_actualizar_propio"
  on public.push_tokens for update
  to authenticated
  using (auth.uid() = user_id);

create policy "push_tokens_borrar_propio"
  on public.push_tokens for delete
  to authenticated
  using (auth.uid() = user_id);

-- Nada de policy de select para el cliente -- solo la Edge Function
-- (con la service role key, que se salta RLS) necesita leer todos los
-- tokens para mandar los push. El dueño del token no necesita leerlo de
-- vuelta para nada.

-- Preferencia de "avisarme si voy a exceder mi presupuesto" -- mismo patrón
-- que el resto de columnas notif_* (la fuente de verdad real es
-- localStorage del dispositivo, esta columna solo la espeja).
alter table public.perfil_financiero
  add column if not exists notif_alerta_presupuesto boolean;

-- Estado de seguimiento por usuario/mes para la Edge Function que evalúa la
-- proyección de gasto (revisar-alertas-presupuesto): cuántos días SEGUIDOS
-- lleva la proyección por encima del presupuesto (colchón antes de avisar,
-- para no disparar por una sola compra grande y aislada) y si ya se avisó
-- este mes (para no mandar el mismo push varias veces). Solo la Edge
-- Function la toca (service role) -- sin políticas de RLS para el cliente.
create table if not exists public.alertas_presupuesto_estado (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mes text not null, -- 'YYYY-MM'
  dias_seguidos_excedido int not null default 0,
  notificado boolean not null default false,
  actualizado_en timestamptz not null default now()
);

alter table public.alertas_presupuesto_estado enable row level security;
