-- Punto de venta: turnos de caja.
--
-- Un turno es al mostrador lo que el reparto es a la ruta: agrupa los pedidos
-- que un cajero captura, entrega y cobra en una tienda, y se cierra con su
-- corte de caja. Los pedidos de la app no llevan turno.
--
-- Todo aditivo: no hay turnos que sembrar y `pedidos.turnoId` nace en null.

-- Folio TUR000123, como el de pedidos, repartos y transferencias.
CREATE SEQUENCE IF NOT EXISTS turnos_pdv_folio_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE "turnos_pdv" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "tiendaId" TEXT NOT NULL,
    "cajeroId" TEXT NOT NULL,
    "cajeroNombre" TEXT NOT NULL,
    "abiertoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoEn" TIMESTAMP(3),
    "efectivoCalculado" DECIMAL(12,2),
    "efectivoDeclarado" DECIMAL(12,2),
    "notas" TEXT,

    CONSTRAINT "turnos_pdv_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "turnos_pdv_folio_key" ON "turnos_pdv"("folio");
CREATE INDEX "turnos_pdv_tiendaId_idx" ON "turnos_pdv"("tiendaId");
CREATE INDEX "turnos_pdv_cajeroId_abiertoEn_idx" ON "turnos_pdv"("cajeroId", "abiertoEn");

-- Un cajero, un turno abierto. Prisma no sabe expresar un indice parcial, asi
-- que vive aqui: sin el, dos pulsaciones de "Crear turno" abririan dos cajas.
CREATE UNIQUE INDEX "turnos_pdv_uno_abierto" ON "turnos_pdv"("cajeroId") WHERE "cerradoEn" IS NULL;

-- Los dos datos del corte van juntos o no van, y solo en un turno cerrado.
ALTER TABLE "turnos_pdv" ADD CONSTRAINT "turnos_pdv_corte_completo" CHECK (
  ("cerradoEn" IS NULL AND "efectivoCalculado" IS NULL AND "efectivoDeclarado" IS NULL)
  OR ("cerradoEn" IS NOT NULL AND "efectivoCalculado" IS NOT NULL AND "efectivoDeclarado" IS NOT NULL)
);

ALTER TABLE "turnos_pdv" ADD CONSTRAINT "turnos_pdv_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "tiendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pedidos" ADD COLUMN "turnoId" TEXT;
CREATE INDEX "pedidos_turnoId_idx" ON "pedidos"("turnoId");
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "turnos_pdv"("id") ON DELETE SET NULL ON UPDATE CASCADE;
