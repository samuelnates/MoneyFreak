-- Mismo patrón de bug que avatar_asesor y terminos_aceptados_en: "si ya
-- viste/omitiste el onboarding rápido" vivía SOLO en localStorage
-- ('onboarding_rapido_omitido'), que no está aislado por cuenta — es del
-- NAVEGADOR, no del usuario. Bug real reportado por el usuario: probó el
-- onboarding con una cuenta de Google en un navegador, y al crear una
-- cuenta NUEVA por correo en ese mismo navegador, esa segunda cuenta (con
-- cero datos) se saltaba el onboarding rápido de Freaky por completo,
-- porque heredaba el "ya lo omití" que en realidad pertenecía a la otra
-- cuenta.
--
-- Se mueve a la base de datos, igual que avatar_asesor y
-- terminos_aceptados_en: null = todavía no completó/omitió el onboarding
-- rápido para ESTA cuenta, sin importar qué otra cuenta se haya usado antes
-- en el mismo navegador.

alter table public.perfil_financiero
  add column if not exists onboarding_rapido_en timestamptz;

comment on column public.perfil_financiero.onboarding_rapido_en is
  'Cuándo el usuario completó u omitió el onboarding rápido de Freaky. null = todavía no. Vive en la base de datos (no localStorage) para que no se herede entre cuentas distintas usadas en el mismo navegador.';
