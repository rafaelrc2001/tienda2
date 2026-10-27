-- Un pedido a credito es cuenta por cobrar desde que se entrega, no desde que
-- Finanzas acepta el corte del reparto. Los que ya se entregaron con la regla
-- vieja y siguen esperando el corte entran ahora, con su fecha de entrega
-- (la del repartidor en la puerta; si no hay, hoy). Solo los que deben algo:
-- total menos billetera menos lo ya pagado.
UPDATE "pedidos" p
SET "cxcDesde" = COALESCE(
  (SELECT e."creadoEn" FROM "entregas_pedido" e WHERE e."pedidoId" = p.id),
  NOW()
)
WHERE p."estadoPago" = 'CREDITO'
  AND p."estado" = 'ENTREGADO'
  AND p."cxcDesde" IS NULL
  AND p."total" - p."pagadoConBilletera"
      - COALESCE((SELECT SUM(g."monto") FROM "pagos_pedido" g WHERE g."pedidoId" = p.id), 0) > 0;
