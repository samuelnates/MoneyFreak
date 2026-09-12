-- Limpieza automática de historial viejo (parte 234 del proyecto).
--
-- Dos cosas MUY distintas se recortan aquí -- nunca las cifras reales que el
-- usuario capturó (gastos, cuentas, deudas, bienes, acciones, ingresos, esas
-- jamás se tocan):
--
-- 1. eventos_uso: analítica interna de qué pantallas visita cada quien. No es
--    un dato que el usuario vea nunca, así que se recorta para TODAS las
--    cuentas por igual, tengan o no plan pagado -- solo se conservan 90 días.
--
-- 2. Snapshots históricos que alimentan las gráficas de tendencia (score,
--    patrimonio, deudas, bienes, saldos) -- estos SÍ los ve el usuario (las
--    gráficas de "tu progreso a través del tiempo"). Se conservan 18 meses
--    para quien no tiene `historial_completo` (el plan pagado que promete
--    "tu historial de por vida"); el saldo MÁS RECIENTE de cada cuenta nunca
--    se borra, sin importar la fecha, porque es el que se muestra como saldo
--    actual en Mis cuentas.
--
-- historial_completo hoy no lo puede activar nadie (no existe todavía un
-- flujo de pago en el proyecto) -- se agrega ahora para que la columna ya
-- exista cuando se construya esa parte. Como la app apenas lleva ~5.5 meses
-- viva, ningún dato real cae todavía dentro de la ventana de 18 meses; este
-- job no borra nada real hasta bien entrado 2027.

alter table perfil_financiero add column if not exists historial_completo boolean not null default false;

create or replace function limpiar_historial_viejo() returns void
language plpgsql
as $$
begin
  delete from eventos_uso where creado_en < now() - interval '90 days';

  delete from score_historico
    where fecha < (now() - interval '18 months')::date
    and user_id in (select user_id from perfil_financiero where not historial_completo);

  delete from patrimonio_historico
    where fecha < (now() - interval '18 months')::date
    and user_id in (select user_id from perfil_financiero where not historial_completo);

  delete from deudas_historico dh
    using deudas d
    where dh.deuda_id = d.id
    and dh.fecha < (now() - interval '18 months')::date
    and d.user_id in (select user_id from perfil_financiero where not historial_completo);

  delete from bienes_historico bh
    using bienes b
    where bh.bien_id = b.id
    and bh.fecha < (now() - interval '18 months')::date
    and b.user_id in (select user_id from perfil_financiero where not historial_completo);

  delete from saldos s
    using cuentas c
    where s.cuenta_id = c.id
    and s.fecha < (now() - interval '18 months')::date
    and c.user_id in (select user_id from perfil_financiero where not historial_completo)
    and s.id <> (
      select s2.id from saldos s2
      where s2.cuenta_id = s.cuenta_id
      order by s2.fecha desc, s2.created_at desc
      limit 1
    );
end;
$$;

select cron.schedule(
  'limpiar-historial-viejo-semanal',
  '0 5 * * 1',
  'select limpiar_historial_viejo();'
);
