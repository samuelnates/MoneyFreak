-- Bug real reportado por el usuario: "loop en el onboarding" — el flag de
-- "ya acepté el Aviso de Privacidad" vivía SOLO en localStorage, que es
-- exclusivo del navegador/dispositivo donde se puso. El link de confirmación
-- de correo SIEMPRE abre una carga de página nueva (a veces en un navegador
-- distinto al que usaste para registrarte — común en celular, ej. el correo
-- se abre en la app de Mail que usa su propio navegador in-app) — en ese
-- contexto nuevo, localStorage está vacío, así que el onboarding volvía a
-- pedir aceptar el aviso aunque ya se hubiera aceptado segundos antes.
--
-- Se mueve a la base de datos, igual que avatar_asesor: null = todavía no
-- aceptó, así que la app sabe la verdad sin importar en qué navegador siga
-- el usuario. Se guarda el timestamp (no solo un boolean) por si algún día
-- hace falta auditar cuándo se aceptó.

alter table public.perfil_financiero
  add column if not exists terminos_aceptados_en timestamptz;

comment on column public.perfil_financiero.terminos_aceptados_en is
  'Cuándo aceptó el usuario el Aviso de Privacidad. null = todavía no. Vive en la base de datos (no localStorage) para que sobreviva un cambio de navegador/dispositivo entre el registro y la confirmación de correo.';
