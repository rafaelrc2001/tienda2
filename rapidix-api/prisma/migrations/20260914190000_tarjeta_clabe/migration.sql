-- Datos bancarios: ademas del numero de cuenta, el negocio comparte numero de
-- tarjeta (depositos en tienda) y CLABE (transferencias SPEI). Ambos opcionales.
ALTER TABLE "configuracion_negocio" ADD COLUMN "numeroTarjeta" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "clabe" TEXT;
