-- Catalogo personalizado de la Tienda (HU-01 a HU-14).
--
-- Tres cosas que la Tienda no podia saber hasta ahora:
--   1. En que orden van las familias, que lo decide el negocio y no la
--      alfabetica.
--   2. Que papel juega cada producto dentro de su familia, para desempatar
--      cuando el cliente no tiene historial.
--   3. Donde se queda el carrito a medias de alguien que cambia de telefono.

-- CreateEnum
CREATE TYPE "RolProducto" AS ENUM ('DESTINO', 'RUTINA', 'ESTACIONAL', 'CONVENIENCIA');

-- AlterTable
ALTER TABLE "categorias" ADD COLUMN "prioridad" INTEGER NOT NULL DEFAULT 99;

-- AlterTable
ALTER TABLE "productos" ADD COLUMN "rol" "RolProducto" NOT NULL DEFAULT 'RUTINA';

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN "carrito" JSONB,
                       ADD COLUMN "carritoEn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "prospectos" ADD COLUMN "carrito" JSONB,
                         ADD COLUMN "carritoEn" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "categorias_prioridad_idx" ON "categorias"("prioridad");

-- Siembra del orden de familias. Es el orden en que se recorre una tienda de
-- barrio, no una preferencia tecnica, y por eso se deja escrito aqui una sola
-- vez: a partir de este punto lo administra el negocio desde la pantalla de
-- Familias. Lo que no reconozca este mapa se queda en 99 y cae al final,
-- ordenado por nombre; nadie se queda fuera del catalogo por no estar aqui.
UPDATE "categorias" SET "prioridad" = CASE lower(btrim("nombre"))
    WHEN 'carnes'             THEN 1
    WHEN 'carnes frias'       THEN 1
    WHEN 'frutas y verduras'  THEN 2
    WHEN 'frutas'             THEN 2
    WHEN 'verduras'           THEN 2
    WHEN 'lácteos'            THEN 3
    WHEN 'lacteos'            THEN 3
    WHEN 'abarrotes'          THEN 4
    WHEN 'panadería'          THEN 5
    WHEN 'panaderia'          THEN 5
    WHEN 'congelados'         THEN 6
    WHEN 'bebidas'            THEN 7
    WHEN 'botanas'            THEN 8
    WHEN 'dulces'             THEN 8
    WHEN 'limpieza'           THEN 9
    WHEN 'higiene'            THEN 10
    WHEN 'cuidado personal'   THEN 10
    WHEN 'mascotas'           THEN 11
    WHEN 'otros'              THEN 12
    ELSE "prioridad"
END;
