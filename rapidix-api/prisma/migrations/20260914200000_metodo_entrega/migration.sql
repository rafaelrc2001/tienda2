-- Metodo de entrega del pedido: a domicilio o recogido en tienda.
--
-- Recoger en tienda no paga envio. Los pedidos anteriores se hicieron todos a
-- domicilio, que es el valor por defecto.

-- CreateEnum
CREATE TYPE "MetodoEntrega" AS ENUM ('DOMICILIO', 'TIENDA');

-- AlterTable
ALTER TABLE "pedidos"
  ADD COLUMN "metodoEntrega" "MetodoEntrega" NOT NULL DEFAULT 'DOMICILIO';
