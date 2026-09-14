-- Metodo de pago del pedido (HU-09 a HU-12).
--
-- El pedido guarda como se cobra (efectivo o transferencia), en que estado
-- esta ese cobro y cuanto se pago con la billetera. Los pedidos anteriores
-- nacieron sin elegir metodo: se quedan como efectivo contra entrega, que es
-- como se venian cobrando.

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('CONTRA_ENTREGA', 'PENDIENTE', 'PAGADO');

-- AlterTable
ALTER TABLE "pedidos"
  ADD COLUMN "metodoPago" "MetodoPago" NOT NULL DEFAULT 'EFECTIVO',
  ADD COLUMN "estadoPago" "EstadoPago" NOT NULL DEFAULT 'CONTRA_ENTREGA',
  ADD COLUMN "pagadoConBilletera" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pagoCon" DECIMAL(12,2),
  ADD COLUMN "cambio" DECIMAL(12,2),
  ADD COLUMN "pagoValidadoEn" TIMESTAMP(3);

-- La billetera nunca paga mas que el pedido.
ALTER TABLE "pedidos"
  ADD CONSTRAINT "pedidos_billetera_rango"
  CHECK ("pagadoConBilletera" >= 0 AND "pagadoConBilletera" <= "total");
