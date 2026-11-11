-- La tasa de IVA deja de suponerse: null = sin configurar.
--
-- Hasta hoy todo producto nacia al 0 % aunque nadie lo eligiera, y la factura
-- salia con esa tasa. Ahora nace sin tasa y un pedido con un producto sin
-- configurar no se factura hasta que alguien elija 0 % o 16 % en Productos.

ALTER TABLE "productos" ALTER COLUMN "tasaIva" DROP DEFAULT,
ALTER COLUMN "tasaIva" DROP NOT NULL;

ALTER TABLE "pedido_items" ALTER COLUMN "tasaIva" DROP DEFAULT,
ALTER COLUMN "tasaIva" DROP NOT NULL;

-- Decision del negocio: ningun 0 % de los que hay se eligio a proposito (era
-- el valor por defecto), asi que todos los productos se revisan. Los 16 %
-- si se marcaron a mano y se conservan.
UPDATE "productos" SET "tasaIva" = NULL WHERE "tasaIva" = 'CERO';

-- Los renglones de pedidos que aun no se facturan sueltan su 0 % supuesto:
-- al facturar toman la tasa que se le configure al producto. Los ya
-- facturados no se tocan: su CFDI congelo la tasa con que se timbro.
UPDATE "pedido_items" i SET "tasaIva" = NULL
FROM "pedidos" p
WHERE p."id" = i."pedidoId"
  AND p."facturaId" IS NULL
  AND i."tasaIva" = 'CERO';
