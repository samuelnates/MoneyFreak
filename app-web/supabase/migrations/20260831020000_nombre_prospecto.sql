-- El mensaje generado saludaba solo con el @handle -- pedido explícito del
-- usuario: quiere dirigirse al influencer por su nombre, no solo por su
-- cuenta. Nullable a propósito: ya hay prospectos reales cargados antes de
-- este cambio (sin nombre todavía) -- se completan a mano desde el panel en
-- vez de perderlos o inventarles un nombre.
alter table public.prospectos_influencer add column if not exists nombre text;
