-- Configuracion -> Datos bancarios -> Cuentas bancarias: el negocio da de alta
-- varias cuentas (banco, numero y titular). No sustituye a los datos de pago
-- de configuracion_negocio, que son los que ve el cliente al transferir.
CREATE TABLE "cuentas_bancarias" (
    "id" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "numeroCuenta" TEXT NOT NULL,
    "titular" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuentas_bancarias_pkey" PRIMARY KEY ("id")
);

-- Configuracion -> Fiscal: RFC, nombre, regimen y CP del negocio. Opcionales
-- para no romper la fila que ya existe.
ALTER TABLE "configuracion_negocio" ADD COLUMN "fiscalRfc" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "fiscalNombre" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "fiscalRegimen" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "fiscalCp" TEXT;
