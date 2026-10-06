-- Abono en la puerta de un pedido a credito.
--
-- Un pedido a credito se entrega sin cobrar, pero el cliente puede darle
-- dinero al repartidor en ese momento. Ese abono es un pago mas del pedido
-- (`pagos_pedido`), con una diferencia: el dinero no lo recibe Finanzas sino
-- el repartidor, asi que entra a su corte y no trae ingreso propio (el del
-- corte ya lo incluye). La columna es lo que distingue uno de otro.
--
-- Aditivo: los pagos que ya existen son todos de Finanzas.
ALTER TABLE "pagos_pedido" ADD COLUMN "enPuerta" BOOLEAN NOT NULL DEFAULT false;
