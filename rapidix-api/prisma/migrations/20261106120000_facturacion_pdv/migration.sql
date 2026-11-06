-- Facturacion desde el punto de venta: varias razones sociales emisoras,
-- facturas que cubren varios pedidos y quien creo cada factura.

-- ------------------------------------------------------------------
-- Razones sociales (Configuracion -> Fiscal)
-- ------------------------------------------------------------------

CREATE TABLE "razones_sociales" (
    "id" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "regimen" TEXT NOT NULL,
    "cp" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "facturaComApiKey" TEXT,
    "facturaComSecretKey" TEXT,
    "facturaComSerie" TEXT,
    "facturaComProduccion" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "razones_sociales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "razones_sociales_rfc_key" ON "razones_sociales"("rfc");

-- Una sola principal: es con la que timbran Mis pedidos, Finanzas y la global.
CREATE UNIQUE INDEX "razones_sociales_una_principal" ON "razones_sociales"("principal") WHERE "principal";

-- Siembra: los datos fiscales que ya estaban capturados pasan a ser la razon
-- social principal. Sin llaves propias, sigue timbrando con las de las
-- variables de entorno, igual que hasta hoy.
INSERT INTO "razones_sociales" ("id", "rfc", "nombre", "regimen", "cp", "principal", "actualizadoEn")
SELECT gen_random_uuid()::text, "fiscalRfc", "fiscalNombre", "fiscalRegimen", "fiscalCp", true, now()
FROM "configuracion_negocio"
WHERE "id" = 1
  AND "fiscalRfc" IS NOT NULL
  AND "fiscalNombre" IS NOT NULL
  AND "fiscalRegimen" IS NOT NULL
  AND "fiscalCp" IS NOT NULL;

ALTER TABLE "configuracion_negocio" DROP COLUMN "fiscalRfc",
DROP COLUMN "fiscalNombre",
DROP COLUMN "fiscalRegimen",
DROP COLUMN "fiscalCp";

-- ------------------------------------------------------------------
-- Una factura puede cubrir varios pedidos
-- ------------------------------------------------------------------

-- La liga se voltea: deja de ser `facturas.pedidoId` (uno a uno) y pasa a ser
-- `pedidos.facturaId`. Borrar una reserva suelta sus pedidos solo.
ALTER TABLE "pedidos" ADD COLUMN "facturaId" TEXT;

UPDATE "pedidos" p SET "facturaId" = f."id" FROM "facturas" f WHERE f."pedidoId" = p."id";

CREATE INDEX "pedidos_facturaId_idx" ON "pedidos"("facturaId");
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- El numero de orden con el que se timbraron las que ya existen: el folio de
-- su pedido.
ALTER TABLE "facturas" ADD COLUMN "numOrden" TEXT;
UPDATE "facturas" f SET "numOrden" = p."folio" FROM "pedidos" p WHERE p."id" = f."pedidoId";

ALTER TABLE "facturas" DROP CONSTRAINT "facturas_pedidoId_fkey";
DROP INDEX "facturas_pedidoId_key";
ALTER TABLE "facturas" DROP COLUMN "pedidoId";

-- Con pedidos de clientes distintos la factura no es de ninguno.
ALTER TABLE "facturas" ALTER COLUMN "clienteId" DROP NOT NULL;

-- Emisor congelado y quien la creo. Las de antes se quedan en null: salen con
-- el emisor de las variables de entorno y sin autor.
ALTER TABLE "facturas" ADD COLUMN "razonSocialId" TEXT,
ADD COLUMN "emisorRfc" TEXT,
ADD COLUMN "emisorNombre" TEXT,
ADD COLUMN "emisorRegimen" TEXT,
ADD COLUMN "emisorCp" TEXT,
ADD COLUMN "creadoPorId" TEXT,
ADD COLUMN "creadoPorNombre" TEXT,
ADD COLUMN "creadoPorRol" TEXT;

-- Una razon social con facturas no se borra: se desactiva.
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_razonSocialId_fkey" FOREIGN KEY ("razonSocialId") REFERENCES "razones_sociales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "facturas_globales" ADD COLUMN "razonSocialId" TEXT;
ALTER TABLE "facturas_globales" ADD CONSTRAINT "facturas_globales_razonSocialId_fkey" FOREIGN KEY ("razonSocialId") REFERENCES "razones_sociales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------
-- Datos fiscales del prospecto
-- ------------------------------------------------------------------

-- El punto de venta da de alta por WhatsApp a quien factura sin estar
-- registrado; viajan al cliente al convertirse.
ALTER TABLE "prospectos" ADD COLUMN "rfc" TEXT,
ADD COLUMN "razonSocial" TEXT,
ADD COLUMN "regimenFiscal" TEXT,
ADD COLUMN "usoCfdi" TEXT,
ADD COLUMN "cpFiscal" TEXT,
ADD COLUMN "emailFacturacion" TEXT;
