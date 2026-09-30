-- Rutas: el pedido por faltante.
--
-- Al liquidar una entrega el repartidor cuenta lo que baja del camion. Si trae
-- menos de lo que el sistema dice que regresa, "Generar pedido x faltante"
-- crea una venta en efectivo por lo que falta, a nombre del cliente "Venta en
-- ruta", entregada en esa misma entrega: su dinero entra al corte.
--
-- La marca distingue esos pedidos de los del cliente: no tienen renglones de
-- camion y su producto se cuenta como entregado en el conteo de la entrega.
-- Nadie los tenia antes: todos nacen en false.

ALTER TABLE "pedidos" ADD COLUMN "porFaltante" BOOLEAN NOT NULL DEFAULT false;
