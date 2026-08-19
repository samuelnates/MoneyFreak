-- Selección de avatar del asesor (antes "Freaky" con un solo diseño fijo).
-- El usuario ahora elige entre 3 avatares visuales para el mismo asistente
-- (misma personalidad/respuestas de la IA, solo cambia el personaje que ve).
-- null = todavía no eligió — así login/la app saben cuándo mostrar la
-- pantalla de selección en vez de asumir un default.

alter table public.perfil_financiero
  add column if not exists avatar_asesor text;

comment on column public.perfil_financiero.avatar_asesor is
  'id del avatar elegido para el asistente conversacional (ver ASESORES en index.html). null = todavía no eligió.';
