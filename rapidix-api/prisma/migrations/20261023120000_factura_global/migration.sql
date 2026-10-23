-- Finanzas -> Bancos -> Factura global: el CFDI a PUBLICO EN GENERAL de los
-- depositos de quien no pidio factura. El receptor es fijo y no se guarda;
-- se guarda lo elegido (InformacionGlobal, forma de pago) y lo timbrado.
CREATE TABLE "facturas_globales" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'TIMBRANDO',
    "modo" "ModoTimbrado" NOT NULL,
    "periodicidad" TEXT NOT NULL,
    "meses" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "cpFiscal" TEXT NOT NULL,
    "email" TEXT,
    "uuid" TEXT,
    "proveedorId" TEXT,
    "serie" TEXT,
    "folio" TEXT,
    "formaPago" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "iva" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "conceptos" JSONB NOT NULL,
    "respuesta" JSONB,
    "timbradaEn" TIMESTAMP(3),
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_globales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "facturas_globales_numero_key" ON "facturas_globales"("numero");
CREATE UNIQUE INDEX "facturas_globales_uuid_key" ON "facturas_globales"("uuid");

ALTER TABLE "facturas_globales" ADD CONSTRAINT "facturas_globales_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El deposito queda apartado por la factura desde que se reserva el timbre.
-- Si la reserva se borra (el SAT la rechazo) el deposito se suelta solo.
ALTER TABLE "movimientos_bancarios" ADD COLUMN "facturaGlobalId" TEXT;

CREATE INDEX "movimientos_bancarios_facturaGlobalId_idx" ON "movimientos_bancarios"("facturaGlobalId");

ALTER TABLE "movimientos_bancarios" ADD CONSTRAINT "movimientos_bancarios_facturaGlobalId_fkey" FOREIGN KEY ("facturaGlobalId") REFERENCES "facturas_globales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
