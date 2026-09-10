-- Precio escalonado y cashback por nivel (HU-08, HU-10, HU-12, HU-17).
--
-- Tres cambios:
--   1. Cada producto puede tener hasta dos listas de precio por volumen ademas
--      de su precio de venta, que pasa a ser la lista 1.
--   2. Cada producto decide si suma a la base del cashback.
--   3. El cashback deja de ser un porcentaje global: sale del nivel del
--      cliente mas un bono manual. `multiplicadorCashback` conserva su valor
--      pero cambia de significado: ya no es el porcentaje, es cuantas veces
--      vale el cashback al ir a la billetera (x2).

-- AlterTable
ALTER TABLE "productos" ADD COLUMN "piso2" INTEGER,
                        ADD COLUMN "precio2" DECIMAL(12,2),
                        ADD COLUMN "piso3" INTEGER,
                        ADD COLUMN "precio3" DECIMAL(12,2),
                        ADD COLUMN "aplicaCashback" BOOLEAN NOT NULL DEFAULT true;

-- La coherencia de las listas vive en el esquema y no solo en el servicio: una
-- lista 3 mas cara que la 2 cobraria de mas justo a quien mas compra, y eso no
-- debe poder entrar ni por una importacion ni a mano en la base.
ALTER TABLE "productos"
    ADD CONSTRAINT "productos_lista2_completa" CHECK (("piso2" IS NULL) = ("precio2" IS NULL)),
    ADD CONSTRAINT "productos_lista3_completa" CHECK (("piso3" IS NULL) = ("precio3" IS NULL)),
    ADD CONSTRAINT "productos_lista3_tras_lista2" CHECK ("piso3" IS NULL OR "piso2" IS NOT NULL),
    ADD CONSTRAINT "productos_lista2_piso" CHECK ("piso2" IS NULL OR "piso2" >= 2),
    ADD CONSTRAINT "productos_lista3_piso" CHECK ("piso3" IS NULL OR "piso3" > "piso2"),
    ADD CONSTRAINT "productos_lista2_precio" CHECK ("precio2" IS NULL OR ("precio2" >= 0 AND "precio2" < "precioVenta")),
    ADD CONSTRAINT "productos_lista3_precio" CHECK ("precio3" IS NULL OR ("precio3" >= 0 AND "precio3" < "precio2"));

-- AlterTable
ALTER TABLE "niveles_fidelidad" ADD COLUMN "porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN "pctExtra" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Siembra del porcentaje de los niveles que ya existian, con la tabla del
-- negocio. Lo que no reconozca este mapa se queda en 0 y se ajusta desde la
-- pantalla de Niveles.
UPDATE "niveles_fidelidad" SET "porcentaje" = CASE lower(btrim("nombre"))
    WHEN 'bronce'  THEN 1
    WHEN 'plata'   THEN 1.5
    WHEN 'oro'     THEN 2
    WHEN 'platino' THEN 2.5
    ELSE "porcentaje"
END;

-- Platino es el cuarto escalon de la tabla del negocio. Solo se crea si no hay
-- ya uno con ese nombre ni otro nivel ocupando la posicion 4.
INSERT INTO "niveles_fidelidad" ("id", "nombre", "umbralGasto", "orden", "porcentaje")
SELECT gen_random_uuid()::text, 'Platino', 90000, 4, 2.5
WHERE NOT EXISTS (
    SELECT 1 FROM "niveles_fidelidad" WHERE lower(btrim("nombre")) = 'platino' OR "orden" = 4
);
