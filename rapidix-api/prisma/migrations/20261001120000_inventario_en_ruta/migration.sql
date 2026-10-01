-- Inventario en ruta: el tercer saldo de cada producto.
--
-- Hasta hoy un producto tenia dos saldos: el fisico y el liberado para venta.
-- Lo que iba arriba de un camion solo se podia saber sumando los renglones de
-- `carga_repartidor`. Ahora `inventarioEnRuta` lo dice en la propia fila: sube
-- al recolectar un pedido y baja cuando el cliente se lo queda, cuando el
-- pedido se quita de la entrega o cuando el corte descarga el camion.
--
-- No se resta del fisico: el fisico baja al entregarse, asi que lo que va en
-- ruta sigue contando en el.

ALTER TABLE "productos" ADD COLUMN "inventarioEnRuta" INTEGER NOT NULL DEFAULT 0;

-- Los camiones que ya van cargados: sin esto arrancarian en cero y su entrega
-- o su corte restarian de un saldo que nunca subio. Es la misma cuenta que
-- lleva el codigo: lo cargado menos lo que ya se quedo el cliente, de los
-- renglones que siguen abiertos.
UPDATE "productos" p
SET "inventarioEnRuta" = c.piezas
FROM (
  SELECT "productoId", SUM("cantidadCargada" - "cantidadEntregada")::int AS piezas
  FROM "carga_repartidor"
  WHERE "cerradoEn" IS NULL
  GROUP BY "productoId"
) c
WHERE p.id = c."productoId" AND c.piezas > 0;

-- La misma red que tienen los otros dos saldos.
ALTER TABLE "productos" ADD CONSTRAINT "productos_inventario_en_ruta_no_negativo" CHECK ("inventarioEnRuta" >= 0);
