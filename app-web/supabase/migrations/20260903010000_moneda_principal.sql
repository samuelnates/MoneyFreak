-- "Moneda principal": la moneda en la que se muestran los totales agregados
-- de toda la app (patrimonio neto, balance, gastos del mes, etc.), sin
-- importar en qué moneda esté cada cuenta/gasto individual. Antes todo se
-- calculaba y mostraba siempre en MXN -- pedido real de un usuario que
-- piensa en dólares (feedback de la parte 153).
--
-- A diferencia de idioma_preferido/tema_preferido (que viven solo en
-- localStorage del dispositivo, el registro en esta tabla es solo para el
-- panel de admin), moneda_principal SÍ se lee de vuelta al iniciar sesión
-- -- es una preferencia financiera real, debe verse igual sin importar
-- desde qué dispositivo entres, igual que avatar_asesor.
alter table public.perfil_financiero
  add column if not exists moneda_principal text not null default 'MXN'
  check (moneda_principal in ('MXN', 'USD', 'EUR'));
