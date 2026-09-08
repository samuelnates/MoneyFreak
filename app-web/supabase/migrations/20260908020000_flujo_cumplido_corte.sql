-- Parte 213: "quiero ver en el flujo cuando cortan mis tarjetas de crédito
-- para revisar el saldo a pagar para no generar intereses". El flujo ahora
-- agrega un ítem de tipo 'corte' por cada tarjeta con día de corte
-- configurado -- flujo_cumplido necesita aceptar ese tipo para que el check
-- "¿ya pasó?" de esos ítems (mismo mecanismo que ya existía para
-- deuda/aportacion/ingreso) se pueda guardar.
alter table flujo_cumplido drop constraint if exists flujo_cumplido_tipo_check;
alter table flujo_cumplido add constraint flujo_cumplido_tipo_check
  check (tipo in ('deuda', 'aportacion', 'ingreso', 'corte'));
