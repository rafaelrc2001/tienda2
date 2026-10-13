-- El precio de una pieza admite hasta quince decimales.
--
-- Con dos, una lista de "3 por $10" no se podia capturar: 3.33 la pieza cobra
-- $9.99. Con 3.333333333333333 el renglon, redondeado a centavos, da $10.00,
-- y lo mismo con cualquier cantidad razonable de piezas.
--
-- Solo cambia la escala del precio por pieza: el de venta, el de las listas 2
-- y 3, y sus copias congeladas en el pedido y en la carga del camion. Los
-- importes (subtotal, total, pagos...) siguen en centavos: el renglon se
-- redondea al multiplicar (`importeDeLinea`).
--
-- DECIMAL(25, 15) conserva los diez digitos enteros que ya cabian. Ampliar la
-- escala no pierde nada: 12.50 pasa a 12.500000000000000.

ALTER TABLE "productos"
    ALTER COLUMN "precioVenta" TYPE DECIMAL(25, 15),
    ALTER COLUMN "precio2" TYPE DECIMAL(25, 15),
    ALTER COLUMN "precio3" TYPE DECIMAL(25, 15);

ALTER TABLE "pedido_items" ALTER COLUMN "precioUnitario" TYPE DECIMAL(25, 15);

ALTER TABLE "carga_repartidor"
    ALTER COLUMN "precioUnitario" TYPE DECIMAL(25, 15),
    ALTER COLUMN "precioEntregado" TYPE DECIMAL(25, 15);
