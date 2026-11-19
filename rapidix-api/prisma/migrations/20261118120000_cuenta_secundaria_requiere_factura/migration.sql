-- Dos cuentas para cobrar transferencias. Los datos bancarios que ya habia se
-- quedan como la cuenta principal (la de quien pide factura); la secundaria
-- nace vacia y, mientras no tenga tarjeta ni CLABE, al cliente sin factura se
-- le da la principal.
ALTER TABLE "configuracion_negocio" ADD COLUMN "bancoSecundaria" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "beneficiarioSecundaria" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "numeroCuentaSecundaria" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "numeroTarjetaSecundaria" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "clabeSecundaria" TEXT;

-- El check "Requiero factura" del carrito. Los pedidos de antes no lo pidieron.
ALTER TABLE "pedidos" ADD COLUMN "requiereFactura" BOOLEAN NOT NULL DEFAULT false;
