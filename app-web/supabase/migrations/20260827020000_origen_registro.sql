-- De dónde vino cada cuenta nueva (TikTok, Instagram, directo, otro sitio
-- que enlace a la app...) -- se captura una sola vez, al aceptar términos
-- por primera vez (ver marcarTerminosAceptados en index.html), a partir de
-- ?utm_source= o del referrer del navegador. null = cuenta creada antes de
-- que esto existiera, o desde la app nativa (no aplica ahí).

alter table public.perfil_financiero
  add column if not exists origen_registro text;

comment on column public.perfil_financiero.origen_registro is
  'De dónde vino la cuenta al registrarse (utm_source o dominio del referrer). Se guarda una sola vez, la primera vez que se aceptan términos. null = anterior a este campo o desde la app nativa.';
