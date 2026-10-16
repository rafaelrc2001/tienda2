-- Facturacion CFDI 4.0: una factura por pedido, timbrada con factura.com o,
-- sin llaves, en modo simulado.
--
-- Todo aditivo y con valores por defecto: los productos y los renglones que ya
-- existian quedan en tasa 0 %, que es la de los alimentos basicos. Lo que vaya
-- al 16 % se corrige en el producto; los renglones viejos se quedan como se
-- vendieron, igual que su precio.

CREATE TYPE "TasaIva" AS ENUM ('CERO', 'DIECISEIS');
CREATE TYPE "ModoTimbrado" AS ENUM ('SIMULADO', 'FACTURA_COM');
CREATE TYPE "EstadoFactura" AS ENUM ('TIMBRANDO', 'TIMBRADA');

ALTER TABLE "productos" ADD COLUMN "tasaIva" "TasaIva" NOT NULL DEFAULT 'CERO';
ALTER TABLE "pedido_items" ADD COLUMN "tasaIva" "TasaIva" NOT NULL DEFAULT 'CERO';

-- Datos fiscales para pre-llenar la siguiente factura. Solo en clientes: un
-- prospecto todavia no tiene nada que facturar.
ALTER TABLE "clientes"
    ADD COLUMN "rfc" TEXT,
    ADD COLUMN "razonSocial" TEXT,
    ADD COLUMN "regimenFiscal" TEXT,
    ADD COLUMN "usoCfdi" TEXT,
    ADD COLUMN "cpFiscal" TEXT,
    ADD COLUMN "emailFacturacion" TEXT;

CREATE TABLE "facturas" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'TIMBRANDO',
    "modo" "ModoTimbrado" NOT NULL,
    "rfc" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "regimenFiscal" TEXT NOT NULL,
    "usoCfdi" TEXT NOT NULL,
    "cpFiscal" TEXT NOT NULL,
    "email" TEXT,
    "uuid" TEXT,
    "proveedorId" TEXT,
    "serie" TEXT,
    "folio" TEXT,
    "formaPago" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL,
    "iva" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "conceptos" JSONB NOT NULL,
    "respuesta" JSONB,
    "timbradaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id"),
    -- Una factura timbrada siempre tiene su folio fiscal y su fecha: sin ellos
    -- seria una reserva que se quedo a medias pintada como factura.
    CONSTRAINT "facturas_timbrada_con_folio" CHECK (
        "estado" = 'TIMBRANDO' OR ("uuid" IS NOT NULL AND "timbradaEn" IS NOT NULL)
    )
);

-- Un pedido, un CFDI. Es el candado de verdad: el boton apagado en la
-- interfaz es solo cortesia.
CREATE UNIQUE INDEX "facturas_pedidoId_key" ON "facturas"("pedidoId");
CREATE UNIQUE INDEX "facturas_uuid_key" ON "facturas"("uuid");
CREATE INDEX "facturas_clienteId_idx" ON "facturas"("clienteId");

ALTER TABLE "facturas" ADD CONSTRAINT "facturas_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
