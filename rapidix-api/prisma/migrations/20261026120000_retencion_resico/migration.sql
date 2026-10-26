-- Retencion de ISR del RESICO: cuando el negocio tributa en el 626 y le
-- factura a una persona moral, esta le retiene el 1.25 %. Las facturas ya
-- timbradas no llevaron retencion: nacen en cero.
ALTER TABLE "facturas" ADD COLUMN "retencionIsr" DECIMAL(12,2) NOT NULL DEFAULT 0;
