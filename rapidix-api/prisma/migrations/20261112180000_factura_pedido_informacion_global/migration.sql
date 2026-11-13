-- Factura de un pedido a PUBLICO EN GENERAL: el SAT exige el nodo
-- InformacionGlobal (CFDI40130) y Finanzas elige su periodo. Se guarda como se
-- timbro para volver a pintar el PDF y el XML simulados igual.
-- Null en las demas facturas, y en las de antes (esas salen con el mes del timbre).
ALTER TABLE "facturas" ADD COLUMN "periodicidad" TEXT;
ALTER TABLE "facturas" ADD COLUMN "meses" TEXT;
ALTER TABLE "facturas" ADD COLUMN "anio" INTEGER;
