-- Embudo de captación de influencers, la etapa ANTES de que exista un código
-- real (ver 20260831000000_influencers.sql para codigos_influencer). El
-- descubrimiento de cuentas sigue siendo manual (buscarlas en IG/TikTok no
-- tiene una API legítima para terceros -- la alternativa sería scraping,
-- que viola los términos de servicio de esas plataformas y no se construyó
-- a propósito) -- esta tabla es para dar seguimiento a mano, rápido, una vez
-- que el admin ya identificó una cuenta candidata.
--
-- Mismo patrón de RLS que codigos_influencer: sin policies para clientes,
-- solo la Edge Function admin-influencers (service role) la toca.

create table if not exists public.prospectos_influencer (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  plataforma text check (plataforma in ('instagram', 'tiktok', 'otra')),
  estado text not null default 'prospecto'
    check (estado in ('prospecto', 'contactado', 'respondio_si', 'respondio_no', 'convertido', 'descartado')),
  nota text,
  contactado_en timestamptz,
  respondido_en timestamptz,
  -- Se llena al convertir (ver acción "convertir_prospecto") -- deja la
  -- trazabilidad de qué código de influencer nació de qué prospecto,
  -- sin duplicar sus datos en las 2 tablas.
  codigo_influencer_id uuid references public.codigos_influencer(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Un mismo handle no debería quedar registrado 2 veces como prospecto
-- (típico: lo agregas, se te olvida, lo vuelves a agregar semanas después).
create unique index if not exists idx_prospectos_handle_unico on public.prospectos_influencer(lower(handle));
create index if not exists idx_prospectos_estado on public.prospectos_influencer(estado);

alter table public.prospectos_influencer enable row level security;
-- Sin policies a propósito -- solo la Edge Function admin-influencers.
