\set ON_ERROR_STOP 1
-- Usuarios
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@x.com',  '{"nombre":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', 'beto@x.com', '{"nombre":"Beto"}');
update perfiles set es_admin = true where nombre = 'Ana';
insert into eventos (id, titulo, opcion_a, opcion_b, inicia)
  values ('00000000-0000-0000-0000-0000000000e1', 'América vs Chivas', 'América', 'Chivas', now() + interval '1 day');

-- Ana crea reto de $200 al lado 0; Beto lo acepta
set app.uid = '00000000-0000-0000-0000-00000000000a';
select crear_reto('00000000-0000-0000-0000-0000000000e1', 0::smallint, 20000) as reto \gset
select set_config('app.reto', :'reto', false);
-- Ana no puede aceptar su propio reto
do $$ begin perform aceptar_reto(current_setting('app.reto')::uuid); raise exception 'FALLA: aceptó su propio reto';
exception when others then if sqlerrm like 'FALLA%' then raise; end if; raise notice 'OK rechazo propio: %', sqlerrm; end $$;
set app.uid = '00000000-0000-0000-0000-00000000000b';
select aceptar_reto(:'reto');
-- Doble aceptación bloqueada
do $$ begin perform aceptar_reto(current_setting('app.reto')::uuid); raise exception 'FALLA: doble aceptación';
exception when others then if sqlerrm like 'FALLA%' then raise; end if; raise notice 'OK doble: %', sqlerrm; end $$;
-- Beto (no admin) no puede resolver
do $$ begin perform resolver_evento('00000000-0000-0000-0000-0000000000e1', '0'); raise exception 'FALLA: no-admin resolvió';
exception when others then if sqlerrm like 'FALLA%' then raise; end if; raise notice 'OK no-admin: %', sqlerrm; end $$;
-- Ana (admin) resuelve: gana lado 0
set app.uid = '00000000-0000-0000-0000-00000000000a';
select resolver_evento('00000000-0000-0000-0000-0000000000e1', '0') as resumen;
select p.nombre, b.saldo from billeteras b join perfiles p on p.id = b.usuario_id order by 1;
select * from auditoria_cuadre;
do $$ declare a record; begin
  select * into a from auditoria_cuadre;
  if a.suma_global <> 0 or a.escrow <> 0 or a.ingresos_casa <> 2000 or a.diferencia_cache <> 0 then raise exception 'FALLA cuadre %', a; end if;
  if (select saldo from billeteras where usuario_id = '00000000-0000-0000-0000-00000000000a') <> 118000 then raise exception 'FALLA saldo Ana'; end if;
  if (select saldo from billeteras where usuario_id = '00000000-0000-0000-0000-00000000000b') <> 80000 then raise exception 'FALLA saldo Beto'; end if;
  raise notice 'TODO OK';
end $$;
