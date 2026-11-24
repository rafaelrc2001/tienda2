-- Horario por tienda y fin del bloqueo y del recargo fuera de horario.
--
-- Cada tienda guarda su horario dia por dia (el sabado puede cerrar antes y
-- no todas abren el domingo). Es informativo: fuera de horario el pedido se
-- acepta y el carrito avisa que queda para la siguiente apertura. Null = sin
-- capturar todavia, y no se avisa nada.
ALTER TABLE "tiendas" ADD COLUMN "horario" JSONB;

-- "Atender fuera de horario" y su porcentaje de recargo desaparecen: ningun
-- pedido se bloquea ni se encarece por la hora. La columna "recargoFuera" de
-- "pedidos" se queda: guarda lo que se cobro en los pedidos anteriores.
ALTER TABLE "configuracion_negocio" DROP COLUMN "atenderFuera";
ALTER TABLE "configuracion_negocio" DROP COLUMN "incrementoFuera";
