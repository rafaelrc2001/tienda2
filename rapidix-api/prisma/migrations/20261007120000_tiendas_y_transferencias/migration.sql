-- Tiendas: inventario por tienda y transferencias desde bodega.
--
-- Hasta hoy la mercancia solo podia estar en bodega o arriba de un camion.
-- Ahora tambien puede estar en una tienda, que es lo que vende el punto de
-- venta. Llega alli con una transferencia, que sigue la misma logica que un
-- pedido en ruta: bodega la arma (se aparta: baja el apt.) y la tienda la
-- "recolecta" al aceptarla (sale del fisico y entra a su inventario).
--
-- Todo aditivo: no hay tiendas ni transferencias que sembrar.

-- Motivo propio para que la bitacora distinga lo que se fue a una tienda de un
-- traspaso capturado a mano.
ALTER TYPE "MotivoMovimiento" ADD VALUE 'TRANSFERENCIA';

ALTER TABLE "movimientos_inventario" ADD COLUMN "transferenciaId" TEXT;
CREATE INDEX "movimientos_inventario_transferenciaId_idx" ON "movimientos_inventario"("transferenciaId");

-- ------------------------------------------------------------------
-- Tiendas
-- ------------------------------------------------------------------
CREATE TABLE "tiendas" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "responsable" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tiendas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tiendas_nombre_key" ON "tiendas"("nombre");

-- ------------------------------------------------------------------
-- Inventario de cada tienda
-- ------------------------------------------------------------------
CREATE TABLE "inventario_tienda" (
    "tiendaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventario_tienda_pkey" PRIMARY KEY ("tiendaId","productoId")
);
CREATE INDEX "inventario_tienda_productoId_idx" ON "inventario_tienda"("productoId");

-- La misma red que tienen los saldos de bodega.
ALTER TABLE "inventario_tienda" ADD CONSTRAINT "inventario_tienda_no_negativo" CHECK ("cantidad" >= 0);

ALTER TABLE "inventario_tienda" ADD CONSTRAINT "inventario_tienda_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "tiendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventario_tienda" ADD CONSTRAINT "inventario_tienda_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------
-- Transferencias
-- ------------------------------------------------------------------
CREATE TYPE "EstadoTransferencia" AS ENUM ('PENDIENTE', 'ACEPTADA', 'CANCELADA');

-- Folio TRA000123: legible y sin colisiones, como el de pedidos y repartos.
CREATE SEQUENCE IF NOT EXISTS transferencias_folio_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE "transferencias" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "tiendaId" TEXT NOT NULL,
    "estado" "EstadoTransferencia" NOT NULL DEFAULT 'PENDIENTE',
    "empleado" TEXT NOT NULL,
    "observaciones" TEXT,
    "creadaPorId" TEXT,
    "creadaPorNombre" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltaPorId" TEXT,
    "resueltaPorNombre" TEXT,
    "resueltaEn" TIMESTAMP(3),

    CONSTRAINT "transferencias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transferencias_folio_key" ON "transferencias"("folio");
CREATE INDEX "transferencias_tiendaId_estado_idx" ON "transferencias"("tiendaId", "estado");
CREATE INDEX "transferencias_creadoEn_idx" ON "transferencias"("creadoEn");

ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "tiendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "transferencia_items" (
    "id" TEXT NOT NULL,
    "transferenciaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "transferencia_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "transferencia_items_transferenciaId_productoId_key" ON "transferencia_items"("transferenciaId", "productoId");

ALTER TABLE "transferencia_items" ADD CONSTRAINT "transferencia_items_cantidad_positiva" CHECK ("cantidad" > 0);

ALTER TABLE "transferencia_items" ADD CONSTRAINT "transferencia_items_transferenciaId_fkey" FOREIGN KEY ("transferenciaId") REFERENCES "transferencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transferencia_items" ADD CONSTRAINT "transferencia_items_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
