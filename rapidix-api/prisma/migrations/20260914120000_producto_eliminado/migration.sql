-- Borrado logico de productos.
--
-- Un producto con pedidos no puede borrarse de verdad: `pedido_items` lo
-- referencia y el historial tiene que seguir apuntando a una fila que existe.
-- Eliminarlo pasa a ser marcar `eliminadoEn`; las lecturas vivas (Tienda,
-- panel, inventario, carrito) filtran las filas marcadas.

-- AlterTable
ALTER TABLE "productos" ADD COLUMN "eliminadoEn" TIMESTAMP(3);
