-- TEMPORAL: telemetria para depurar el importe encimado de «Comprar ahora» en
-- Safari iOS. Cuando se cierre el caso se quita con otra migracion
-- (DROP TABLE "diagnostico_ui") junto con el modelo y el modulo.
CREATE TABLE "diagnostico_ui" (
    "id" BIGSERIAL NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sesion" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "usuarioId" TEXT,
    "userAgent" TEXT,
    "datos" JSONB NOT NULL,

    CONSTRAINT "diagnostico_ui_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "diagnostico_ui_sesion_creadoEn_idx" ON "diagnostico_ui"("sesion", "creadoEn");
CREATE INDEX "diagnostico_ui_creadoEn_idx" ON "diagnostico_ui"("creadoEn");
