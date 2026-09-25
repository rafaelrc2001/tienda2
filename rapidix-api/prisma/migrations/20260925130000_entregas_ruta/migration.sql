-- Rutas: entregas (viajes) dentro de la jornada del repartidor.
--
-- Un repartidor arma una o varias entregas y a cada una le sube pedidos. El
-- pedido guarda una sola `entregaRutaId`, asi que no puede ir en dos entregas
-- a la vez. Los pedidos que ya van en un camion no se reasignan: se quedan sin
-- entrega y se terminan de repartir como hasta hoy.

CREATE TABLE "entregas_ruta" (
  "id"           TEXT NOT NULL,
  "sesionId"     TEXT NOT NULL,
  "repartidorId" TEXT NOT NULL,
  "numero"       INTEGER NOT NULL,
  "nombre"       TEXT,
  "creadoEn"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entregas_ruta_pkey" PRIMARY KEY ("id")
);

-- Entrega 1, 2, 3... por jornada: dos pulsaciones de "Crear entrega" a la vez
-- no pueden sacar el mismo numero.
CREATE UNIQUE INDEX "entregas_ruta_sesionId_numero_key" ON "entregas_ruta"("sesionId", "numero");
CREATE INDEX "entregas_ruta_repartidorId_idx" ON "entregas_ruta"("repartidorId");

ALTER TABLE "entregas_ruta"
  ADD CONSTRAINT "entregas_ruta_sesionId_fkey" FOREIGN KEY ("sesionId")
  REFERENCES "sesiones_entrega"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entregas_ruta"
  ADD CONSTRAINT "entregas_ruta_repartidorId_fkey" FOREIGN KEY ("repartidorId")
  REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pedidos" ADD COLUMN "entregaRutaId" TEXT;
CREATE INDEX "pedidos_entregaRutaId_idx" ON "pedidos"("entregaRutaId");
ALTER TABLE "pedidos"
  ADD CONSTRAINT "pedidos_entregaRutaId_fkey" FOREIGN KEY ("entregaRutaId")
  REFERENCES "entregas_ruta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
