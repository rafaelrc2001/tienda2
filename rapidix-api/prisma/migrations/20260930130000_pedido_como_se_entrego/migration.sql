-- Rutas: el pedido queda como se entrego.
--
-- Hasta ahora una entrega parcial no tocaba el pedido: seguia diciendo lo que
-- se compro y era el corte quien restaba lo no aceptado al calcular el
-- efectivo. Desde esta version la entrega deja el pedido con lo que el cliente
-- se quedo (renglones, subtotal, total, billetera, cashback) y el corte cobra
-- el total tal cual.
--
-- Esta migracion hace lo mismo con los pedidos que ya se entregaron en
-- parcial, para que el corte no les cobre de mas y se lean igual que los
-- nuevos. No toca la estructura: solo datos.
--
-- Lo entregado de cada renglon es su ultima carga: los intentos anteriores
-- que regresaron a bodega aceptaron cero y se cargaron antes. Los cancelados
-- se dejan como estan (su cancelacion ya desconto el total entero del gasto),
-- y el pedido por faltante no sube al camion.

CREATE TEMP TABLE _entregado AS
SELECT DISTINCT ON (c."pedidoItemId")
  c."pedidoId",
  c."pedidoItemId",
  c."cantidadCargada",
  c."cantidadEntregada",
  c."precioUnitario",
  COALESCE(c."precioEntregado", c."precioUnitario") AS "precioFinal"
FROM "carga_repartidor" c
JOIN "pedidos" p ON p.id = c."pedidoId"
WHERE p.estado = 'ENTREGADO'
  AND p."estadoPago" <> 'CANCELADO'
  AND NOT p."porFaltante"
ORDER BY c."pedidoItemId", c."creadoEn" DESC;

-- Solo los renglones que cambian: entrega completa al mismo precio, nada.
DELETE FROM _entregado
WHERE "cantidadEntregada" = "cantidadCargada" AND "precioFinal" = "precioUnitario";

-- Lo que valia lo no aceptado, por pedido, y como queda su dinero.
CREATE TEMP TABLE _ajuste AS
SELECT
  p.id,
  p."clienteId",
  p.folio,
  p.total AS "totalAnterior",
  p."pagadoConBilletera" AS "billeteraAnterior",
  GREATEST(0, p.subtotal - n."noEntregado") AS subtotal,
  GREATEST(0, p.total - n."noEntregado") AS total
FROM "pedidos" p
JOIN (
  SELECT "pedidoId",
    SUM("precioUnitario" * "cantidadCargada" - "precioFinal" * "cantidadEntregada") AS "noEntregado"
  FROM _entregado
  GROUP BY "pedidoId"
) n ON n."pedidoId" = p.id;

-- 1. Los renglones: lo aceptado, al precio que toca por lo aceptado.
UPDATE "pedido_items" i
SET cantidad = e."cantidadEntregada",
    "precioUnitario" = e."precioFinal"
FROM _entregado e
WHERE i.id = e."pedidoItemId";

-- 2. El pedido. La billetera nunca pasa del total nuevo, y el cambio avisado
--    al comprar se rehace sobre lo que queda por cobrar.
UPDATE "pedidos" p
SET subtotal = a.subtotal,
    total = a.total,
    "pagadoConBilletera" = LEAST(a."billeteraAnterior", a.total),
    cambio = CASE
      WHEN p."pagoCon" IS NULL THEN NULL
      ELSE GREATEST(0, p."pagoCon" - (a.total - LEAST(a."billeteraAnterior", a.total)))
    END
FROM _ajuste a
WHERE p.id = a.id;

-- 3. El cashback que aun no se acredita se recalcula con el % congelado al
--    comprar, sobre lo que se quedo, y nunca sube. El ya acreditado se deja:
--    retirarlo a destiempo podria dejar saldos negativos que nadie espera.
UPDATE "pedidos" p
SET "cashbackGenerado" = LEAST(
  p."cashbackGenerado",
  CASE
    WHEN b.base > cfg."montoMinimoCashback"
      THEN ROUND(FLOOR(b.base * p."porcentajeCashback" / 100) * cfg."multiplicadorCashback", 2)
    ELSE 0
  END
)
FROM _ajuste a
JOIN (
  SELECT i."pedidoId", COALESCE(SUM(i."precioUnitario" * i.cantidad) FILTER (WHERE pr."aplicaCashback"), 0) AS base
  FROM "pedido_items" i
  JOIN "productos" pr ON pr.id = i."productoId"
  GROUP BY i."pedidoId"
) b ON b."pedidoId" = a.id
CROSS JOIN (SELECT "montoMinimoCashback", "multiplicadorCashback" FROM "configuracion_negocio" WHERE id = 1) cfg
WHERE p.id = a.id
  AND p."cashbackAcreditadoEn" IS NULL;

-- 4. La billetera que ya no hacia falta vuelve al cliente, con su movimiento.
INSERT INTO "movimientos_cashback" (id, "clienteId", "pedidoId", monto, concepto, "creadoEn")
SELECT
  gen_random_uuid()::text,
  a."clienteId",
  a.id,
  a."billeteraAnterior" - a.total,
  'Devolución de billetera: el pedido ' || a.folio || ' se entregó incompleto',
  now()
FROM _ajuste a
WHERE a."billeteraAnterior" > a.total;

-- 5. El saldo y el gasto del cliente. El nivel se recalcula con su siguiente
--    compra, como siempre.
UPDATE "clientes" c
SET "saldoCashback" = c."saldoCashback" + s.devuelta,
    "totalGastado" = c."totalGastado" - s.baja
FROM (
  SELECT "clienteId",
    SUM(GREATEST(0, "billeteraAnterior" - total)) AS devuelta,
    SUM("totalAnterior" - total) AS baja
  FROM _ajuste
  GROUP BY "clienteId"
) s
WHERE c.id = s."clienteId";

-- Las tablas de trabajo no se quedan en la sesion.
DROP TABLE _ajuste;
DROP TABLE _entregado;
