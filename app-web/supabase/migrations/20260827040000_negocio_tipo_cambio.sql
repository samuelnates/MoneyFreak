-- Tipo de cambio al que se pagó cada movimiento en dólares -- se captura el
-- que el usuario realmente pagó en ese momento (no uno de mercado en vivo),
-- para poder consolidar todo el estado de resultados en pesos sin inventar
-- una conversión. Solo aplica a movimientos en USD; en MXN se queda null.

alter table public.negocio_movimientos
  add column if not exists tipo_cambio numeric;

comment on column public.negocio_movimientos.tipo_cambio is
  'Pesos por dólar al momento de pagar (solo si moneda = USD). null en movimientos ya en MXN.';
