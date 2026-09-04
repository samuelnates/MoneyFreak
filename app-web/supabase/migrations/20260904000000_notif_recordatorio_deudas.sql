-- Mismo patrón que el resto de columnas notif_* de
-- 20260827050000_eventos_uso_y_preferencias.sql: la preferencia vive en
-- localStorage del dispositivo, esta columna solo la espeja para poder
-- verla agregada en el panel de admin (sincronizarPreferenciaPerfil).
alter table public.perfil_financiero
  add column if not exists notif_recordatorio_deudas boolean;
