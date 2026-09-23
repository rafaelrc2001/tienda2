-- Operaciones, Rutas y Finanzas, etapa 3: la jornada del repartidor, lo que
-- lleva en el camion y el corte con el que entrega el dinero.
--
-- Nada de esto toca los pedidos que ya existen: son tablas nuevas y cuatro
-- columnas opcionales en `pedidos`. Un pedido anterior queda sin repartidor y
-- sin liquidar, que es exactamente lo que es.

-- ------------------------------------------------------------------
-- Catalogos
-- ------------------------------------------------------------------
CREATE TYPE "MotivoDevolucion" AS ENUM (
  'NO_LO_QUISO', 'DANADO', 'SIN_QUIEN_RECIBA', 'PRECIO_EQUIVOCADO'
);
CREATE TYPE "EstadoCorte" AS ENUM ('CERRADO', 'RECIBIDO');

-- ------------------------------------------------------------------
-- Cortes
-- ------------------------------------------------------------------
-- Va primero porque las sesiones y los pedidos apuntan a el.
CREATE TABLE "cortes" (
  "id"             TEXT NOT NULL,
  "repartidorId"   TEXT NOT NULL,
  "cerradoEn"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "montoCalculado" DECIMAL(12,2) NOT NULL,
  "montoDeclarado" DECIMAL(12,2) NOT NULL,
  "montoRecibido"  DECIMAL(12,2),
  "recibidoEn"     TIMESTAMP(3),
  "recibidoPorId"  TEXT,
  "estado"         "EstadoCorte" NOT NULL DEFAULT 'CERRADO',
  "notas"          TEXT,
  CONSTRAINT "cortes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cortes_estado_cerradoEn_idx" ON "cortes"("estado", "cerradoEn");
ALTER TABLE "cortes"
  ADD CONSTRAINT "cortes_repartidorId_fkey" FOREIGN KEY ("repartidorId")
  REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cortes_recibidoPorId_fkey" FOREIGN KEY ("recibidoPorId")
  REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Los tres datos de la recepcion van juntos o no van: un corte recibido sin
-- monto contado, o un monto contado sin quien lo conto, serian un corte que
-- nadie puede auditar. La base lo impide en vez de confiar en el servicio.
ALTER TABLE "cortes" ADD CONSTRAINT "cortes_recepcion_completa" CHECK (
  ("estado" = 'CERRADO'  AND "recibidoEn" IS NULL     AND "recibidoPorId" IS NULL     AND "montoRecibido" IS NULL) OR
  ("estado" = 'RECIBIDO' AND "recibidoEn" IS NOT NULL AND "recibidoPorId" IS NOT NULL AND "montoRecibido" IS NOT NULL)
);

-- Quien recibe el corte no puede ser quien lo cerro: el que trae el dinero no
-- se lo cuenta a si mismo.
ALTER TABLE "cortes" ADD CONSTRAINT "cortes_recibe_otro" CHECK (
  "recibidoPorId" IS NULL OR "recibidoPorId" <> "repartidorId"
);

CREATE TABLE "cortes_abonos" (
  "id"              TEXT NOT NULL,
  "corteId"         TEXT NOT NULL,
  "monto"           DECIMAL(12,2) NOT NULL,
  "registradoPorId" TEXT NOT NULL,
  "nota"            TEXT,
  "creadoEn"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cortes_abonos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cortes_abonos_corteId_idx" ON "cortes_abonos"("corteId");
ALTER TABLE "cortes_abonos"
  ADD CONSTRAINT "cortes_abonos_corteId_fkey" FOREIGN KEY ("corteId")
  REFERENCES "cortes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "cortes_abonos_registradoPorId_fkey" FOREIGN KEY ("registradoPorId")
  REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Abonar cero o en negativo no es abonar.
ALTER TABLE "cortes_abonos" ADD CONSTRAINT "cortes_abonos_monto_positivo" CHECK ("monto" > 0);

-- ------------------------------------------------------------------
-- Jornada
-- ------------------------------------------------------------------
CREATE TABLE "sesiones_entrega" (
  "id"           TEXT NOT NULL,
  "repartidorId" TEXT NOT NULL,
  "iniciadaEn"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizadaEn" TIMESTAMP(3),
  "corteId"      TEXT,
  CONSTRAINT "sesiones_entrega_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sesiones_entrega_repartidorId_iniciadaEn_idx"
  ON "sesiones_entrega"("repartidorId", "iniciadaEn");
ALTER TABLE "sesiones_entrega"
  ADD CONSTRAINT "sesiones_entrega_repartidorId_fkey" FOREIGN KEY ("repartidorId")
  REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sesiones_entrega_corteId_fkey" FOREIGN KEY ("corteId")
  REFERENCES "cortes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- **Una sola jornada sin liquidar por repartidor.** Prisma no sabe escribir un
-- indice parcial, asi que va aqui: sin el, dos pulsaciones de "Inicio de
-- entregas" abririan dos jornadas y la carga del camion quedaria repartida
-- entre las dos.
CREATE UNIQUE INDEX "sesiones_entrega_una_viva"
  ON "sesiones_entrega"("repartidorId") WHERE "corteId" IS NULL;

-- ------------------------------------------------------------------
-- Camion
-- ------------------------------------------------------------------
CREATE TABLE "carga_repartidor" (
  "id"                TEXT NOT NULL,
  "sesionId"          TEXT NOT NULL,
  "repartidorId"      TEXT NOT NULL,
  "pedidoId"          TEXT NOT NULL,
  "pedidoItemId"      TEXT NOT NULL,
  "productoId"        TEXT NOT NULL,
  "cantidadCargada"   INTEGER NOT NULL,
  "cantidadEntregada" INTEGER NOT NULL DEFAULT 0,
  "cantidadDevuelta"  INTEGER NOT NULL DEFAULT 0,
  "precioUnitario"    DECIMAL(12,2) NOT NULL,
  "precioEntregado"   DECIMAL(12,2),
  "motivoDevolucion"  "MotivoDevolucion",
  "cerradoEn"         TIMESTAMP(3),
  "creadoEn"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "carga_repartidor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "carga_repartidor_pedidoId_idx" ON "carga_repartidor"("pedidoId");
CREATE INDEX "carga_repartidor_sesionId_idx" ON "carga_repartidor"("sesionId");
ALTER TABLE "carga_repartidor"
  ADD CONSTRAINT "carga_repartidor_sesionId_fkey" FOREIGN KEY ("sesionId")
  REFERENCES "sesiones_entrega"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "carga_repartidor_repartidorId_fkey" FOREIGN KEY ("repartidorId")
  REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "carga_repartidor_pedidoId_fkey" FOREIGN KEY ("pedidoId")
  REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "carga_repartidor_pedidoItemId_fkey" FOREIGN KEY ("pedidoItemId")
  REFERENCES "pedido_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "carga_repartidor_productoId_fkey" FOREIGN KEY ("productoId")
  REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Del camion no puede salir mas de lo que subio, ni en entregas ni en
-- devoluciones.
ALTER TABLE "carga_repartidor"
  ADD CONSTRAINT "carga_repartidor_cantidades" CHECK (
    "cantidadCargada" > 0 AND "cantidadEntregada" >= 0 AND "cantidadDevuelta" >= 0
    AND "cantidadEntregada" + "cantidadDevuelta" <= "cantidadCargada"
  );

-- **Un renglon del pedido no puede ir en dos camiones a la vez.** Cuando
-- regresa a bodega su fila se cierra (`cerradoEn`), y solo entonces puede
-- salir de nuevo con una fila nueva.
CREATE UNIQUE INDEX "carga_repartidor_item_en_camion"
  ON "carga_repartidor"("pedidoItemId") WHERE "cerradoEn" IS NULL;

-- ------------------------------------------------------------------
-- Evidencia de la entrega
-- ------------------------------------------------------------------
-- Las imagenes viven en `imagenes` (carpeta `entregas`) y aqui solo se apunta:
-- una foto y una firma por entrega cabrian en la fila, pero las traerian
-- consigo en cada consulta de la pantalla de Rutas.
CREATE TABLE "entregas_pedido" (
  "pedidoId"     TEXT NOT NULL,
  "repartidorId" TEXT NOT NULL,
  "fotoId"       TEXT,
  "firmaId"      TEXT,
  "lat"          DECIMAL(10,7),
  "lng"          DECIMAL(10,7),
  "creadoEn"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entregas_pedido_pkey" PRIMARY KEY ("pedidoId")
);
ALTER TABLE "entregas_pedido"
  ADD CONSTRAINT "entregas_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId")
  REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "entregas_pedido_repartidorId_fkey" FOREIGN KEY ("repartidorId")
  REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------
-- Lo que el pedido necesita saber de su ruta
-- ------------------------------------------------------------------
ALTER TABLE "pedidos"
  ADD COLUMN "repartidorId" TEXT,
  ADD COLUMN "liquidado"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "liquidadoEn"  TIMESTAMP(3),
  ADD COLUMN "corteId"      TEXT;

CREATE INDEX "pedidos_repartidorId_idx" ON "pedidos"("repartidorId");
ALTER TABLE "pedidos"
  ADD CONSTRAINT "pedidos_repartidorId_fkey" FOREIGN KEY ("repartidorId")
  REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "pedidos_corteId_fkey" FOREIGN KEY ("corteId")
  REFERENCES "cortes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
