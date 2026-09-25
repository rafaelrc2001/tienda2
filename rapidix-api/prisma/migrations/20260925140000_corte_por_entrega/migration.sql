-- Rutas: cada entrega se finaliza y se corta por su lado.
--
-- Hasta hoy "Finalizar entregas" y "Hacer mi corte" eran de la jornada entera.
-- Ahora viven en cada entrega: `finalizadaEn` dice que ya no sale nada mas en
-- ella y `corteId` la ata a su corte. El corte de la ultima entrega viva es el
-- que cierra la jornada. Las entregas que ya existen nacen vivas y sin
-- finalizar; las de jornadas ya cortadas se quedan asi, de consulta.

ALTER TABLE "entregas_ruta" ADD COLUMN "finalizadaEn" TIMESTAMP(3);
ALTER TABLE "entregas_ruta" ADD COLUMN "corteId" TEXT;

CREATE INDEX "entregas_ruta_corteId_idx" ON "entregas_ruta"("corteId");

ALTER TABLE "entregas_ruta"
  ADD CONSTRAINT "entregas_ruta_corteId_fkey" FOREIGN KEY ("corteId")
  REFERENCES "cortes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
