-- Reemplazo propio de un "pixel" de terceros (Hotjar/FullStory/etc.): sin
-- SDK externo, sin grabar pantalla, solo un evento ligero por cada cambio
-- de pantalla real dentro de la app, con cuánto tiempo estuvo esa pantalla
-- activa. Vive en nuestra propia base -- nunca sale de aquí, y no obliga a
-- cambiar la ficha de privacidad de Apple porque no es "tracking" de
-- terceros ni cruza límites de la app.

create table if not exists public.eventos_uso (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null, -- 'pantalla' | 'clic_social'
  detalle text not null, -- id de la pantalla, o 'tiktok'/'instagram'
  duracion_ms integer, -- solo aplica a tipo='pantalla'
  creado_en timestamptz not null default now()
);

alter table public.eventos_uso enable row level security;

create policy "eventos_uso_insertar_propio"
  on public.eventos_uso for insert
  to authenticated
  with check (auth.uid() = user_id);

create index if not exists eventos_uso_tipo_detalle_idx
  on public.eventos_uso (tipo, detalle);

-- Preferencias que hoy solo viven en localStorage de cada dispositivo
-- (notificaciones, si Freaky vuela o está quieto, días de aviso de
-- tarjeta) -- mismo patrón que idioma_preferido/tema_preferido: se
-- guardan aquí también cuando el usuario las cambia, para poder verlas
-- agregadas en el panel de admin.
alter table public.perfil_financiero
  add column if not exists notif_gastos_frecuencia text;
alter table public.perfil_financiero
  add column if not exists notif_saldos_frecuencia text;
alter table public.perfil_financiero
  add column if not exists notif_reporte_mes boolean;
alter table public.perfil_financiero
  add column if not exists freaky_vuelo_desactivado boolean;
alter table public.perfil_financiero
  add column if not exists freaky_dias_aviso_tarjeta int;
