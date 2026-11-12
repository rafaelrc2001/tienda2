-- Varios emisores: una cuenta de factura.com por RFC, todas en las variables
-- de entorno (FACTURACOM_API_KEY, FACTURACOM_API_KEY_2...).
--
-- Cada tienda factura por defecto con uno (null = el principal) y el punto de
-- venta puede cambiarlo al facturar. La factura de un pedido ya congelaba el
-- RFC del emisor (`facturas.emisorRfc`); la global no, y hace falta para
-- pedir su PDF y su XML con las llaves de quien la timbro.

ALTER TABLE "tiendas" ADD COLUMN "emisorRfc" TEXT;

ALTER TABLE "facturas_globales" ADD COLUMN "emisorRfc" TEXT;
