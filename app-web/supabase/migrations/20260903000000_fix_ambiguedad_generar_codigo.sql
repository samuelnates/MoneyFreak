-- Corrige un bug real reportado por el usuario: el botón "blindar" del panel
-- de administrador (dar sin_anuncios + IA gratis a mano a un usuario que
-- todavía no tiene fila en perfil_financiero) fallaba con "internal_error".
--
-- Causa raíz encontrada en los logs reales de la Edge Function
-- (admin-influencers, vía la Management API): "column reference \"codigo\" is
-- ambiguous". La migración 20260831000000_influencers.sql reemplazó
-- generar_codigo_referido() para además chequear contra codigos_influencer,
-- pero esa cláusula quedó como `where codigo = codigo` -- ambas apariciones
-- de "codigo" podían referirse tanto a la columna real de la tabla
-- codigos_influencer como a la variable local declarada en la función, así
-- que Postgres no puede resolverlo solo y lo rechaza. Esto solo se disparaba
-- cuando el trigger BEFORE INSERT de perfil_financiero (asignar_codigo_referido)
-- corría para una fila NUEVA (ej. el upsert de "blindar" en un usuario que
-- aún no tenía fila propia) -- para usuarios que ya tenían fila (el caso más
-- común) el trigger nunca se disparaba, por eso no se había notado antes.
--
-- Primer intento de arreglo (calificar solo el lado de la tabla,
-- `codigos_influencer.codigo`) NO fue suficiente -- Postgres sigue marcando
-- como ambigua CUALQUIER aparición sin calificar de "codigo" en la consulta
-- mientras siga existiendo una variable plpgsql con ese nombre en el mismo
-- alcance, no solo la que choca directamente. La forma robusta de verdad es
-- renombrar la variable local para que ya no pueda chocar con ninguna
-- columna real, presente o futura, sin tener que acordarse de calificar cada
-- referencia.
create or replace function generar_codigo_referido() returns text as $$
declare
  alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  codigo_generado text;
  existe boolean;
begin
  loop
    codigo_generado := '';
    for i in 1..6 loop
      codigo_generado := codigo_generado || substr(alfabeto, floor(random() * length(alfabeto) + 1)::int, 1);
    end loop;
    select exists(select 1 from perfil_financiero where codigo_referido = codigo_generado)
        or exists(select 1 from codigos_influencer where codigo = codigo_generado)
      into existe;
    exit when not existe;
  end loop;
  return codigo_generado;
end;
$$ language plpgsql;
