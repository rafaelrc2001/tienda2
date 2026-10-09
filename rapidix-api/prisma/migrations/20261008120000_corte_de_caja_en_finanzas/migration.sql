-- El corte de caja del punto de venta pasa por Finanzas.
--
-- Hasta hoy el corte se quedaba en el PDV: el cajero contaba, se guardaba la
-- diferencia y ese efectivo nunca llegaba al libro de ingresos. Ahora sigue el
-- camino del corte de ruta, sin la mercancia: nace LIQUIDADO, Finanzas acepta
-- el dinero (queda en `ingresos`), y si falto algo el turno queda con adeudo
-- hasta que el cajero lo cubre con abonos que Finanzas tambien acepta.
--
-- Todo aditivo.

-- ------------------------------------------------------------------
-- Turnos: en que va su corte y que dinero se le acepto
-- ------------------------------------------------------------------

ALTER TABLE "turnos_pdv"
  ADD COLUMN "estadoCorte" "EstadoCorte",
  ADD COLUMN "efectivoRecibido" DECIMAL(12,2),
  ADD COLUMN "recibidoEn" TIMESTAMP(3),
  ADD COLUMN "recibidoPorId" TEXT,
  ADD COLUMN "recibidoPorNombre" TEXT;

-- Siembra: los cortes de caja que ya existen nunca pasaron por Finanzas, asi
-- que quedan por aceptar. Al aceptarlos su efectivo entra al libro con la
-- fecha en que de verdad se acepte, no con una inventada.
UPDATE "turnos_pdv" SET "estadoCorte" = 'LIQUIDADO' WHERE "cerradoEn" IS NOT NULL;

CREATE INDEX "turnos_pdv_estadoCorte_cerradoEn_idx" ON "turnos_pdv"("estadoCorte", "cerradoEn");

-- El estatus existe solo con el corte hecho.
ALTER TABLE "turnos_pdv" ADD CONSTRAINT "turnos_pdv_estado_con_corte" CHECK (
  ("cerradoEn" IS NULL) = ("estadoCorte" IS NULL)
);

-- Los datos del dinero aceptado van juntos o no van, como en `cortes`.
ALTER TABLE "turnos_pdv" ADD CONSTRAINT "turnos_pdv_recepcion_completa" CHECK (
  ("recibidoEn" IS NULL     AND "recibidoPorId" IS NULL     AND "recibidoPorNombre" IS NULL     AND "efectivoRecibido" IS NULL) OR
  ("recibidoEn" IS NOT NULL AND "recibidoPorId" IS NOT NULL AND "recibidoPorNombre" IS NOT NULL AND "efectivoRecibido" IS NOT NULL)
);

-- ------------------------------------------------------------------
-- Abonos del cajero: pendientes hasta que Finanzas los acepta
-- ------------------------------------------------------------------

CREATE TABLE "turnos_pdv_abonos" (
  "id"                  TEXT NOT NULL,
  "turnoId"             TEXT NOT NULL,
  "monto"               DECIMAL(12,2) NOT NULL,
  "registradoPorId"     TEXT NOT NULL,
  "registradoPorNombre" TEXT NOT NULL,
  "nota"                TEXT,
  "creadoEn"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "aceptadoEn"          TIMESTAMP(3),
  "aceptadoPorId"       TEXT,
  "aceptadoPorNombre"   TEXT,
  CONSTRAINT "turnos_pdv_abonos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "turnos_pdv_abonos_turnoId_idx" ON "turnos_pdv_abonos"("turnoId");
ALTER TABLE "turnos_pdv_abonos"
  ADD CONSTRAINT "turnos_pdv_abonos_turnoId_fkey" FOREIGN KEY ("turnoId")
  REFERENCES "turnos_pdv"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "turnos_pdv_abonos" ADD CONSTRAINT "turnos_pdv_abonos_monto_positivo" CHECK ("monto" > 0);

-- Un solo abono pendiente por turno. Prisma no sabe expresar un indice unico
-- parcial, asi que vive aqui.
CREATE UNIQUE INDEX "turnos_pdv_abonos_un_pendiente"
  ON "turnos_pdv_abonos"("turnoId") WHERE "aceptadoEn" IS NULL;

-- ------------------------------------------------------------------
-- Ingresos: el efectivo de la caja entra al libro
-- ------------------------------------------------------------------

-- Nadie usa el valor nuevo en esta migracion: Postgres no deja usarlo en la
-- misma transaccion en que se agrega.
ALTER TYPE "ConceptoIngreso" ADD VALUE 'PDV';

ALTER TABLE "ingresos"
  ADD COLUMN "turnoPdvId" TEXT,
  ADD COLUMN "turnoAbonoId" TEXT;

CREATE UNIQUE INDEX "ingresos_turnoAbonoId_key" ON "ingresos"("turnoAbonoId");
CREATE INDEX "ingresos_turnoPdvId_idx" ON "ingresos"("turnoPdvId");
ALTER TABLE "ingresos"
  ADD CONSTRAINT "ingresos_turnoPdvId_fkey" FOREIGN KEY ("turnoPdvId")
  REFERENCES "turnos_pdv"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ingresos_turnoAbonoId_fkey" FOREIGN KEY ("turnoAbonoId")
  REFERENCES "turnos_pdv_abonos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El dinero de un corte de caja se acepta una sola vez; lo demas son abonos.
CREATE UNIQUE INDEX "ingresos_un_dinero_por_turno"
  ON "ingresos"("turnoPdvId") WHERE "turnoAbonoId" IS NULL AND "turnoPdvId" IS NOT NULL;
