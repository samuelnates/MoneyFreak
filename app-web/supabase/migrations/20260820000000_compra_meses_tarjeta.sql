-- Marca las cuotas de una compra a meses pagada CON tarjeta, para que
-- editar/eliminar una cuota individual sepa que nunca debe volver a tocar el
-- saldo de la tarjeta (el total ya se cargó completo el día de la compra).
-- El caso SIN tarjeta ya tiene su propio identificador (compra_meses_deuda_id,
-- apunta a la deuda virtual) — este es el equivalente para el caso con tarjeta,
-- que hasta ahora no tenía ninguna forma de distinguirse de un gasto suelto.

alter table public.gastos
  add column if not exists compra_meses_tarjeta boolean not null default false;
