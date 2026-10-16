-- Claves del SAT por producto (c_ClaveProdServ y c_ClaveUnidad), para que la
-- factura no lleve la generica 01010101 en todo.
--
-- Nulas en lo que ya existia: un producto sin clasificar se sigue facturando
-- como hasta hoy. Que la clave exista en el catalogo lo comprueba la API, que
-- es quien lo tiene; aqui solo el formato.

ALTER TABLE "productos"
    ADD COLUMN "claveProdServ" TEXT,
    ADD COLUMN "claveUnidad" TEXT;

ALTER TABLE "productos"
    ADD CONSTRAINT "productos_claveProdServ_formato" CHECK ("claveProdServ" ~ '^[0-9]{8}$'),
    ADD CONSTRAINT "productos_claveUnidad_formato" CHECK ("claveUnidad" ~ '^[A-Za-z0-9]{1,3}$');
