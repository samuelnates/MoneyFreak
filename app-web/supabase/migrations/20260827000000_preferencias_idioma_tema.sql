-- Guarda del lado del servidor las preferencias de idioma y tema que hoy
-- solo vivían en localStorage (por dispositivo) -- para poder ver, de forma
-- agregada, qué prefieren los usuarios (panel de administración).

alter table public.perfil_financiero
  add column if not exists idioma_preferido text;

alter table public.perfil_financiero
  add column if not exists tema_preferido text;

comment on column public.perfil_financiero.idioma_preferido is
  'Último idioma elegido explícitamente en Configuración ("es"/"en"). null = nunca lo cambió ahí (puede seguir usando otro idioma solo guardado en su dispositivo).';

comment on column public.perfil_financiero.tema_preferido is
  'Último tema elegido explícitamente en Configuración ("light"/"dark"/"auto"). null = nunca lo cambió ahí.';
