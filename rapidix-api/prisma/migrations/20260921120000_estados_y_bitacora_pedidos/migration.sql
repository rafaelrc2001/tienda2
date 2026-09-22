-- Operaciones, Rutas y Finanzas, etapa 1: los dos ejes de estatus del pedido,
-- su bitacora y el cashback que espera al pago.
--
-- Postgres no deja quitar valores de un enum: los dos tipos se recrean y cada
-- pedido se convierte con su CASE.

-- ------------------------------------------------------------------
-- Eje de pago
-- ------------------------------------------------------------------
-- Va antes que el fisico porque lee el viejo `estado = CANCELADO`: cancelar
-- pasa a ser una decision del eje de pago.
--   CONTRA_ENTREGA, PENDIENTE -> PAGO_PENDIENTE (todavia nadie cobro)
--   PAGADO                    -> PAGADO
--   pedido CANCELADO          -> CANCELADO
ALTER TYPE "EstadoPago" RENAME TO "EstadoPago_viejo";
CREATE TYPE "EstadoPago" AS ENUM (
  'PAGO_PENDIENTE', 'LIBERAR', 'RETENER', 'CREDITO', 'REEMBOLSADO', 'PAGADO', 'CANCELADO'
);
ALTER TABLE "pedidos" ALTER COLUMN "estadoPago" DROP DEFAULT;
ALTER TABLE "pedidos" ALTER COLUMN "estadoPago" TYPE "EstadoPago" USING (
  CASE
    WHEN "estado"::text = 'CANCELADO' THEN 'CANCELADO'
    WHEN "estadoPago"::text = 'PAGADO' THEN 'PAGADO'
    ELSE 'PAGO_PENDIENTE'
  END
)::"EstadoPago";
ALTER TABLE "pedidos" ALTER COLUMN "estadoPago" SET DEFAULT 'PAGO_PENDIENTE';
DROP TYPE "EstadoPago_viejo";

-- ------------------------------------------------------------------
-- Eje fisico
-- ------------------------------------------------------------------
-- Un cancelado conserva donde se quedo la caja. Los que habia nunca salieron
-- de CONFIRMADO, que es el unico estado que el codigo producia.
ALTER TYPE "EstadoPedido" RENAME TO "EstadoPedido_viejo";
CREATE TYPE "EstadoPedido" AS ENUM (
  'CONFIRMADO', 'EN_PREPARACION', 'PREPARADO', 'LISTO_PARA_ENTREGA',
  'RECOLECTADO', 'EN_RUTA', 'ENTREGADO'
);
ALTER TABLE "pedidos" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "pedidos" ALTER COLUMN "estado" TYPE "EstadoPedido" USING (
  CASE WHEN "estado"::text = 'CANCELADO' THEN 'CONFIRMADO' ELSE "estado"::text END
)::"EstadoPedido";
ALTER TABLE "pedidos" ALTER COLUMN "estado" SET DEFAULT 'CONFIRMADO';
DROP TYPE "EstadoPedido_viejo";

-- ------------------------------------------------------------------
-- Cashback al pagar
-- ------------------------------------------------------------------
ALTER TABLE "pedidos"
  ADD COLUMN "porcentajeCashback"   DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "cashbackAcreditadoEn" TIMESTAMP(3);

-- Hasta hoy el cashback se acreditaba al crear el pedido: todos los que ya
-- existen lo recibieron entonces. Se marcan para que pagarlos no lo duplique.
UPDATE "pedidos" SET "cashbackAcreditadoEn" = "creadoEn";

-- ------------------------------------------------------------------
-- Bitacora
-- ------------------------------------------------------------------
CREATE TYPE "EjeBitacora" AS ENUM ('PEDIDO', 'PAGO');
CREATE TYPE "ActorBitacora" AS ENUM ('CLIENTE', 'PERSONAL', 'SISTEMA');

CREATE TABLE "bitacora_pedidos" (
  "id"             TEXT NOT NULL,
  "pedidoId"       TEXT NOT NULL,
  "eje"            "EjeBitacora" NOT NULL,
  "estadoAnterior" TEXT,
  "estadoNuevo"    TEXT NOT NULL,
  "nota"           TEXT,
  "actor"          "ActorBitacora" NOT NULL,
  "actorId"        TEXT,
  "actorNombre"    TEXT NOT NULL,
  "creadoEn"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bitacora_pedidos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bitacora_pedidos_pedidoId_creadoEn_idx" ON "bitacora_pedidos"("pedidoId", "creadoEn");
ALTER TABLE "bitacora_pedidos"
  ADD CONSTRAINT "bitacora_pedidos_pedidoId_fkey" FOREIGN KEY ("pedidoId")
  REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Los pedidos anteriores no tienen historia: se les reconstruye lo unico que
-- se sabe con certeza, que el cliente lo creo y en que estado de pago esta.
-- La nota lo deja dicho para que nadie lo lea como un registro de la epoca.
INSERT INTO "bitacora_pedidos"
  ("id", "pedidoId", "eje", "estadoAnterior", "estadoNuevo", "nota", "actor", "actorId", "actorNombre", "creadoEn")
SELECT gen_random_uuid()::text, p."id", 'PEDIDO', NULL, 'CONFIRMADO',
       'Reconstruido al crear la bitácora', 'CLIENTE', p."clienteId", c."nombre", p."creadoEn"
FROM "pedidos" p
JOIN "clientes" c ON c."id" = p."clienteId";

INSERT INTO "bitacora_pedidos"
  ("id", "pedidoId", "eje", "estadoAnterior", "estadoNuevo", "nota", "actor", "actorId", "actorNombre", "creadoEn")
SELECT gen_random_uuid()::text, p."id", 'PAGO', NULL, p."estadoPago"::text,
       'Reconstruido al crear la bitácora', 'SISTEMA', NULL, 'Rapidix',
       COALESCE(p."pagoValidadoEn", p."creadoEn")
FROM "pedidos" p;
