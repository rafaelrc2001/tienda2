-- AlterTable
ALTER TABLE "cupones_emitidos" ADD COLUMN     "prospectoId" TEXT,
ALTER COLUMN "clienteId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "prospectos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "fuenteCodigo" TEXT,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospectos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospectos_telefono_key" ON "prospectos"("telefono");

-- CreateIndex
CREATE INDEX "prospectos_creado_idx" ON "prospectos"("creado");

-- CreateIndex
CREATE INDEX "cupones_emitidos_prospectoId_status_idx" ON "cupones_emitidos"("prospectoId", "status");

-- AddForeignKey
ALTER TABLE "cupones_emitidos" ADD CONSTRAINT "cupones_emitidos_prospectoId_fkey" FOREIGN KEY ("prospectoId") REFERENCES "prospectos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
