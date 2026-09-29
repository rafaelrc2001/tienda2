-- Rutas: cada renglon del camion recuerda la entrega en la que subio.
--
-- El pedido suelta su `entregaRutaId` cuando regresa a bodega en el corte, asi
-- que despues ya no se sabia que habia salido en esa entrega. El historial del
-- repartidor lo necesita: "pedidos que salieron" incluye los que volvieron.
--
-- Siembra: los renglones que siguen en el camion, y los de una entrega que si
-- llego (algo acepto el cliente), son de la entrega en la que esta el pedido.
-- Los intentos devueltos de antes no se pueden atribuir con certeza y se
-- quedan en null: el historial de esas entregas viejas sale incompleto.

ALTER TABLE "carga_repartidor" ADD COLUMN "entregaRutaId" TEXT;

UPDATE "carga_repartidor" AS c
SET "entregaRutaId" = p."entregaRutaId"
FROM "pedidos" AS p
WHERE c."pedidoId" = p."id"
  AND p."entregaRutaId" IS NOT NULL
  AND (c."cerradoEn" IS NULL OR c."cantidadEntregada" > 0);

CREATE INDEX "carga_repartidor_entregaRutaId_idx" ON "carga_repartidor"("entregaRutaId");

ALTER TABLE "carga_repartidor"
  ADD CONSTRAINT "carga_repartidor_entregaRutaId_fkey" FOREIGN KEY ("entregaRutaId")
  REFERENCES "entregas_ruta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
