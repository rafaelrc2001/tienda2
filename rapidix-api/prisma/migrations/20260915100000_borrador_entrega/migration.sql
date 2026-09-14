-- Borrador de la entrega del checkout (metodo y direccion de ESTE pedido).
--
-- Se respalda junto al carrito sincronizado para no perderlo si el navegador
-- borra su almacenamiento. No es la direccion del perfil: esa solo cambia con
-- el boton explicito "Guardar en mi perfil". Nace vacio para todos.

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN "borradorEntrega" JSONB;

-- AlterTable
ALTER TABLE "prospectos" ADD COLUMN "borradorEntrega" JSONB;
