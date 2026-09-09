-- Almacen de imagenes dentro de la propia base de datos.
--
-- Hasta ahora la unica forma de subir una foto era un bucket S3, y sin las
-- variables `S3_*` el boton de adjuntar quedaba deshabilitado. Con esta tabla
-- la API puede guardar los bytes ella misma y servirlos por
-- `GET /uploads/local/:id`, asi que el entorno sin bucket deja de quedarse sin
-- imagenes. Cuando haya S3 configurado se sigue usando S3 y esta tabla se
-- queda vacia.

-- CreateTable
CREATE TABLE "imagenes" (
    "id" TEXT NOT NULL,
    "carpeta" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "tamanoBytes" INTEGER NOT NULL,
    "datos" BYTEA NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imagenes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imagenes_creadoEn_idx" ON "imagenes"("creadoEn");
