-- Las categorias dejan de ser texto suelto en cada producto y pasan a ser una
-- tabla propia. Los productos que ya existen no se pierden: se siembra el
-- catalogo con las categorias que ya estaban escritas y se reapunta cada
-- producto a la suya.

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nombre_key" ON "categorias"("nombre");

-- Siembra: una fila por categoria distinta. Las variantes que solo cambian en
-- mayusculas o en espacios de sobra se funden en una sola.
INSERT INTO "categorias" ("id", "nombre", "creadoEn", "actualizadoEn")
SELECT gen_random_uuid()::text, x."nombre", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (lower(btrim("categoria"))) btrim("categoria") AS "nombre"
    FROM "productos"
    WHERE btrim("categoria") <> ''
    ORDER BY lower(btrim("categoria")), btrim("categoria")
) AS x;

-- AlterTable
ALTER TABLE "productos" ADD COLUMN "categoriaId" TEXT;

UPDATE "productos" p
SET "categoriaId" = c."id"
FROM "categorias" c
WHERE lower(btrim(p."categoria")) = lower(c."nombre");

-- Red de seguridad: un producto sin categoria legible no puede quedarse sin
-- fila a la que apuntar, asi que cae en una categoria de descarte.
INSERT INTO "categorias" ("id", "nombre", "creadoEn", "actualizadoEn")
SELECT gen_random_uuid()::text, 'Sin categoria', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "productos" WHERE "categoriaId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "categorias" WHERE lower("nombre") = 'sin categoria');

UPDATE "productos"
SET "categoriaId" = (SELECT "id" FROM "categorias" WHERE lower("nombre") = 'sin categoria')
WHERE "categoriaId" IS NULL;

ALTER TABLE "productos" ALTER COLUMN "categoriaId" SET NOT NULL;

-- DropIndex
DROP INDEX IF EXISTS "productos_categoria_idx";

-- AlterTable
ALTER TABLE "productos" DROP COLUMN "categoria";

-- CreateIndex
CREATE INDEX "productos_categoriaId_idx" ON "productos"("categoriaId");

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
