-- Nueva señal del Score Money Freak: "Constancia" — qué tan seguido el
-- usuario alimenta la app con información real (gastos, saldos, pagos a
-- deuda), no solo qué tan sana está su situación financiera. Se calcula en
-- el cliente (calcularConstanciaMoneyFreak() en index.html) y se guarda aquí
-- junto con las otras 4 señales existentes, mismo patrón.

alter table public.score_historico
  add column if not exists constancia numeric;
