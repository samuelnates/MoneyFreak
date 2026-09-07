-- Parte 200: agrega el espacio para guardar reseñas/calificación reales de
-- App Store Connect en la misma caché de analítica de Apple (evita crear
-- una tabla aparte solo para esto -- vive en la misma fila 'actual').
alter table public.analitica_apple_cache add column if not exists reseñas jsonb;
