-- Cada entrega tiene su propio "Iniciar entrega": crearla ya no la arranca.
--
-- Las que ya existen se dan por iniciadas cuando se crearon, que es lo que
-- pasaba antes: si no, las que van en la calle quedarian bloqueadas.

ALTER TABLE "entregas_ruta" ADD COLUMN "iniciadaEn" TIMESTAMP(3);

UPDATE "entregas_ruta" SET "iniciadaEn" = "creadoEn";
