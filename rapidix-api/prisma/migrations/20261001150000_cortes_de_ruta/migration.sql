-- Cortes de ruta, ingresos y cuentas por cobrar.
--
-- Liquidar una entrega deja de ser un solo golpe. El repartidor liquida y
-- Finanzas acepta por partes: primero la mercancia que regresa, luego el
-- dinero, y al final la entrega. Lo que acepta de dinero queda en un libro
-- (`ingresos`) y lo que un cliente quedo a deber, en una cuenta por cobrar que
-- se va pagando (`pagos_pedido`).
--
-- Todo es aditivo salvo el CHECK de la recepcion, que se cambia mas abajo.

-- ------------------------------------------------------------------
-- Entregas: folio de reparto
-- ------------------------------------------------------------------

-- "Entrega 2" solo dice algo dentro de su jornada. El folio es lo que se
-- escribe en un ingreso y se le dicta a alguien por telefono. Sin guion, como
-- el de los pedidos.
CREATE SEQUENCE IF NOT EXISTS entregas_ruta_folio_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE "entregas_ruta"
  ADD COLUMN "folio" TEXT,
  ADD COLUMN "rechazoDevolucion" TEXT,
  ADD COLUMN "rechazoDevolucionEn" TIMESTAMP(3);

-- Las que ya existen se numeran en el orden en que se crearon.
UPDATE "entregas_ruta" e
SET "folio" = 'REP' || lpad(n.numero::text, 6, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY "creadoEn", id) AS numero
  FROM "entregas_ruta"
) n
WHERE e.id = n.id;

-- La secuencia sigue donde acabo la siembra. Sin entregas arranca en 1: el
-- tercer argumento dice si el valor ya se uso.
SELECT setval(
  'entregas_ruta_folio_seq',
  GREATEST((SELECT count(*) FROM "entregas_ruta"), 1),
  (SELECT count(*) > 0 FROM "entregas_ruta")
);

ALTER TABLE "entregas_ruta" ALTER COLUMN "folio" SET NOT NULL;
CREATE UNIQUE INDEX "entregas_ruta_folio_key" ON "entregas_ruta"("folio");

-- ------------------------------------------------------------------
-- Cortes: quien acepto que
-- ------------------------------------------------------------------

ALTER TABLE "cortes"
  ADD COLUMN "devolucionAceptadaEn" TIMESTAMP(3),
  ADD COLUMN "devolucionAceptadaPorId" TEXT,
  ADD COLUMN "entregaAceptadaEn" TIMESTAMP(3),
  ADD COLUMN "entregaAceptadaPorId" TEXT;

ALTER TABLE "cortes"
  ADD CONSTRAINT "cortes_devolucionAceptadaPorId_fkey" FOREIGN KEY ("devolucionAceptadaPorId")
  REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "cortes_entregaAceptadaPorId_fkey" FOREIGN KEY ("entregaAceptadaPorId")
  REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- El CHECK viejo ataba el dinero recibido al estatus: sin recibir, el primero;
-- recibido, el segundo. Ya no se sostiene: un corte con el dinero aceptado
-- vuelve a LIQUIDADO cuando el repartidor abona, y acaba en CERRADO. Lo que si
-- se sostiene es lo que de verdad cuidaba: los tres datos del dinero aceptado
-- van juntos o no van.
ALTER TABLE "cortes" DROP CONSTRAINT "cortes_recepcion_completa";
ALTER TABLE "cortes" ADD CONSTRAINT "cortes_recepcion_completa" CHECK (
  ("recibidoEn" IS NULL     AND "recibidoPorId" IS NULL     AND "montoRecibido" IS NULL) OR
  ("recibidoEn" IS NOT NULL AND "recibidoPorId" IS NOT NULL AND "montoRecibido" IS NOT NULL)
);

-- ------------------------------------------------------------------
-- Abonos: pendientes hasta que Finanzas los acepta
-- ------------------------------------------------------------------

ALTER TABLE "cortes_abonos"
  ADD COLUMN "aceptadoEn" TIMESTAMP(3),
  ADD COLUMN "aceptadoPorId" TEXT;

ALTER TABLE "cortes_abonos"
  ADD CONSTRAINT "cortes_abonos_aceptadoPorId_fkey" FOREIGN KEY ("aceptadoPorId")
  REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------------
-- Pedidos: cuenta por cobrar y sus pagos
-- ------------------------------------------------------------------

ALTER TABLE "pedidos" ADD COLUMN "cxcDesde" TIMESTAMP(3);
CREATE INDEX "pedidos_cxcDesde_idx" ON "pedidos"("cxcDesde");

CREATE TABLE "pagos_pedido" (
  "id"              TEXT NOT NULL,
  "pedidoId"        TEXT NOT NULL,
  "monto"           DECIMAL(12,2) NOT NULL,
  "metodo"          "MetodoPago" NOT NULL,
  "nota"            TEXT,
  "registradoPorId" TEXT NOT NULL,
  "creadoEn"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pagos_pedido_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pagos_pedido_pedidoId_idx" ON "pagos_pedido"("pedidoId");
ALTER TABLE "pagos_pedido"
  ADD CONSTRAINT "pagos_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId")
  REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pagos_pedido_registradoPorId_fkey" FOREIGN KEY ("registradoPorId")
  REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pagos_pedido" ADD CONSTRAINT "pagos_pedido_monto_positivo" CHECK ("monto" > 0);

-- ------------------------------------------------------------------
-- Ingresos: el libro de lo que Finanzas acepto
-- ------------------------------------------------------------------

CREATE TYPE "ConceptoIngreso" AS ENUM ('ENTREGA', 'CXC');

-- Solo se escribe. Por eso sus llaves foraneas son RESTRICT: borrar un corte,
-- un abono o un pago que ya dejo un ingreso seria borrar dinero del libro.
CREATE TABLE "ingresos" (
  "id"              TEXT NOT NULL,
  "concepto"        "ConceptoIngreso" NOT NULL,
  "referencia"      TEXT NOT NULL,
  "monto"           DECIMAL(12,2) NOT NULL,
  "metodo"          "MetodoPago" NOT NULL,
  "nota"            TEXT,
  "corteId"         TEXT,
  "corteAbonoId"    TEXT,
  "pagoPedidoId"    TEXT,
  "registradoPorId" TEXT NOT NULL,
  "creadoEn"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ingresos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ingresos_corteAbonoId_key" ON "ingresos"("corteAbonoId");
CREATE UNIQUE INDEX "ingresos_pagoPedidoId_key" ON "ingresos"("pagoPedidoId");
CREATE INDEX "ingresos_creadoEn_idx" ON "ingresos"("creadoEn");
CREATE INDEX "ingresos_concepto_creadoEn_idx" ON "ingresos"("concepto", "creadoEn");
CREATE INDEX "ingresos_corteId_idx" ON "ingresos"("corteId");
ALTER TABLE "ingresos"
  ADD CONSTRAINT "ingresos_corteId_fkey" FOREIGN KEY ("corteId")
  REFERENCES "cortes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ingresos_corteAbonoId_fkey" FOREIGN KEY ("corteAbonoId")
  REFERENCES "cortes_abonos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ingresos_pagoPedidoId_fkey" FOREIGN KEY ("pagoPedidoId")
  REFERENCES "pagos_pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ingresos_registradoPorId_fkey" FOREIGN KEY ("registradoPorId")
  REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ingresos" ADD CONSTRAINT "ingresos_monto_positivo" CHECK ("monto" > 0);

-- El dinero con que se liquida un corte se acepta una sola vez; lo demas son
-- abonos, y cada uno trae su propio ingreso. Prisma no sabe expresar un indice
-- unico parcial, asi que vive aqui.
CREATE UNIQUE INDEX "ingresos_un_dinero_por_corte"
  ON "ingresos"("corteId") WHERE "corteAbonoId" IS NULL AND "corteId" IS NOT NULL;

-- ------------------------------------------------------------------
-- Siembra: lo que ya paso, dicho con las palabras nuevas
-- ------------------------------------------------------------------

-- Todos los cortes que existen descargaron su camion al cerrarse, con la regla
-- anterior: su devolucion ya esta aceptada. Queda sin "por quien" porque nadie
-- la acepto: la descargo el propio corte.
UPDATE "cortes" SET "devolucionAceptadaEn" = "cerradoEn";

-- Los que Finanzas ya recibio tienen tambien aceptada la entrega.
UPDATE "cortes"
SET "entregaAceptadaEn" = "recibidoEn", "entregaAceptadaPorId" = "recibidoPorId"
WHERE "estado" = 'ACEPTADO';

-- Los abonos de antes contaban desde que se registraban: ya estan aceptados.
UPDATE "cortes_abonos" a
SET "aceptadoEn" = a."creadoEn",
    "aceptadoPorId" = COALESCE(c."recibidoPorId", a."registradoPorId")
FROM "cortes" c
WHERE c.id = a."corteId";

-- Y ahora si: un solo abono pendiente por corte. Va despues de la siembra
-- porque antes de ella todos los abonos viejos parecian pendientes.
CREATE UNIQUE INDEX "cortes_abonos_un_pendiente"
  ON "cortes_abonos"("corteId") WHERE "aceptadoEn" IS NULL;

-- El libro cuadra con la historia: un ingreso por lo que Finanzas recibio de
-- cada corte, con la fecha en que lo recibio. Los cortes de jornada entera, de
-- antes de que cada entrega se cortara por su lado, no tienen entrega propia
-- ni por tanto folio: van con S/F.
INSERT INTO "ingresos"
  ("id", "concepto", "referencia", "monto", "metodo", "corteId", "registradoPorId", "creadoEn")
SELECT
  gen_random_uuid()::text,
  'ENTREGA',
  COALESCE(
    (SELECT e."folio" FROM "entregas_ruta" e WHERE e."corteId" = c.id ORDER BY e."numero" LIMIT 1),
    'S/F'
  ),
  c."montoRecibido",
  'EFECTIVO',
  c.id,
  c."recibidoPorId",
  c."recibidoEn"
FROM "cortes" c
WHERE c."montoRecibido" IS NOT NULL AND c."montoRecibido" > 0;

-- Y uno por cada abono.
INSERT INTO "ingresos"
  ("id", "concepto", "referencia", "monto", "metodo", "nota",
   "corteId", "corteAbonoId", "registradoPorId", "creadoEn")
SELECT
  gen_random_uuid()::text,
  'ENTREGA',
  COALESCE(
    (SELECT e."folio" FROM "entregas_ruta" e WHERE e."corteId" = c.id ORDER BY e."numero" LIMIT 1),
    'S/F'
  ),
  a."monto",
  'EFECTIVO',
  a."nota",
  c.id,
  a.id,
  COALESCE(a."aceptadoPorId", a."registradoPorId"),
  a."creadoEn"
FROM "cortes_abonos" a
JOIN "cortes" c ON c.id = a."corteId";

-- Aceptado y sin adeudo es CERRADO. La cuenta es la del codigo: lo calculado
-- menos lo recibido y sus abonos, con medio centavo de tolerancia.
UPDATE "cortes" c
SET "estado" = 'CERRADO'
WHERE c."estado" = 'ACEPTADO'
  AND c."montoCalculado" - c."montoRecibido" - COALESCE(
        (SELECT SUM(a."monto") FROM "cortes_abonos" a WHERE a."corteId" = c.id), 0
      ) <= 0.005;

-- Los creditos que ya se entregaron y siguen debiendo son cuentas por cobrar
-- desde que se entregaron. Los de ruta, solo si Finanzas ya recibio su corte:
-- los de un corte por aceptar entraran al pulsar "Entrega aceptada".
UPDATE "pedidos" p
SET "cxcDesde" = COALESCE(p."liquidadoEn", p."creadoEn")
WHERE p."estadoPago" = 'CREDITO'
  AND p."estado" = 'ENTREGADO'
  AND p."total" - p."pagadoConBilletera" > 0
  AND (
    p."metodoEntrega" = 'TIENDA'
    OR EXISTS (
      SELECT 1 FROM "cortes" c WHERE c.id = p."corteId" AND c."estado" <> 'LIQUIDADO'
    )
  );
