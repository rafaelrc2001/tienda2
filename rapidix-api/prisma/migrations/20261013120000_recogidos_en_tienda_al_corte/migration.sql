-- Los pedidos de la app que se recogen en una tienda entran al corte de caja.
--
-- Hasta ahora se entregaban desde la pestana Operaciones del PDV sin quedar
-- atados a ningun turno: la mercancia salia de la tienda pero ni el pedido ni
-- su dinero aparecian en el corte. Desde este cambio la entrega los ata al
-- turno abierto de quien los entrega (`pedidos.turnoId`).
--
-- Sin cambios de esquema: solo se siembran los que ya se entregaron asi. Cada
-- uno va al turno de quien lo entrego (el actor de su renglon de bitacora), en
-- esa tienda, que ya estaba abierto al entregarlo y que **sigue abierto**: un
-- corte ya hecho congelo sus cifras y no se le agrega nada. Los que no tienen
-- un turno asi se quedan como estaban.
--
-- El estatus de pago no se toca: marcar pagado acredita el cashback, y eso lo
-- hace la aplicacion. El que siga en "Pago pendiente" aparece en el turno pero
-- no suma a la caja hasta que Finanzas lo marque Pagado.

UPDATE "pedidos" p
SET "turnoId" = entrega."turnoId"
FROM (
  SELECT DISTINCT ON (b."pedidoId") b."pedidoId", t."id" AS "turnoId"
  FROM "bitacora_pedidos" b
  JOIN "pedidos" pe ON pe."id" = b."pedidoId"
  JOIN "turnos_pdv" t
    ON t."tiendaId" = pe."tiendaId"
   AND t."cajeroId" = b."actorId"
   AND t."cerradoEn" IS NULL
   AND t."abiertoEn" <= b."creadoEn"
  WHERE b."eje" = 'PEDIDO' AND b."estadoNuevo" = 'ENTREGADO'
  ORDER BY b."pedidoId", b."creadoEn" DESC
) entrega
WHERE p."id" = entrega."pedidoId"
  AND p."turnoId" IS NULL
  AND p."tiendaId" IS NOT NULL
  AND p."estado" = 'ENTREGADO';
