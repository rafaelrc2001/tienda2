-- Inventario de bodega y su bitacora.
--
-- Los productos que ya existen arrancan en cero: nadie ha capturado todavia
-- su existencia real. Por eso el interruptor `controlInventario` nace apagado
-- y los pedidos siguen sin mirar el saldo hasta que se encienda a mano.

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('ENTRADA', 'SALIDA');

-- CreateEnum
CREATE TYPE "AfectaInventario" AS ENUM ('AMBOS', 'FISICO', 'APT');

-- CreateEnum
CREATE TYPE "MotivoMovimiento" AS ENUM ('COMPRA', 'VENTA', 'MERMA', 'TRASPASO', 'AJUSTE', 'DEVOLUCION');

-- AlterTable
ALTER TABLE "productos" ADD COLUMN     "aptInventario" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inventario" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "configuracion_negocio" ADD COLUMN     "controlInventario" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "afecta" "AfectaInventario" NOT NULL,
    "motivo" "MotivoMovimiento" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "empleado" TEXT NOT NULL,
    "observaciones" TEXT,
    "usuarioId" TEXT,
    "usuarioNombre" TEXT,
    "pedidoId" TEXT,
    "fisicoAntes" INTEGER NOT NULL,
    "fisicoDespues" INTEGER NOT NULL,
    "aptAntes" INTEGER NOT NULL,
    "aptDespues" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimientos_inventario_productoId_creadoEn_idx" ON "movimientos_inventario"("productoId", "creadoEn");

-- CreateIndex
CREATE INDEX "movimientos_inventario_creadoEn_idx" ON "movimientos_inventario"("creadoEn");

-- CreateIndex
CREATE INDEX "movimientos_inventario_pedidoId_idx" ON "movimientos_inventario"("pedidoId");

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El saldo no puede quedar negativo ni por un error de codigo: la condicion
-- viaja en el WHERE de cada UPDATE, y esto es la red por debajo.
ALTER TABLE "productos" ADD CONSTRAINT "productos_inventario_no_negativo" CHECK ("inventario" >= 0 AND "aptInventario" >= 0);
