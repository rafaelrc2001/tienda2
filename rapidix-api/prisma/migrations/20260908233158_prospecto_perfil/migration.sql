-- AlterTable
ALTER TABLE "prospectos" ADD COLUMN     "calle" TEXT,
ADD COLUMN     "ciudad" TEXT,
ADD COLUMN     "colonia" TEXT,
ADD COLUMN     "cp" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "estado" TEXT,
ADD COLUMN     "fechaNacimiento" TIMESTAMP(3),
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "notificaciones" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quienRecibe" TEXT,
ADD COLUMN     "referencias" TEXT,
ADD COLUMN     "sucursal" TEXT;
