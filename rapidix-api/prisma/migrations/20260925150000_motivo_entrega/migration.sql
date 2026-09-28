-- Inventario: la venta y la salida fisica son dos momentos distintos.
--
-- Al pedir, la VENTA solo aparta lo vendido (baja el APT). Al entregarse, la
-- mercancia sale de verdad y se registra una ENTREGA que baja el fisico. Motivo
-- propio para que la bitacora distinga los dos momentos y para que las
-- devoluciones, que se calculan desde las VENTA del pedido, no la confundan con
-- lo apartado. No hace falta siembra: los pedidos viejos vendieron con AMBOS y
-- ya descontaron el fisico.

ALTER TYPE "MotivoMovimiento" ADD VALUE 'ENTREGA';
