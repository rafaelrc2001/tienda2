-- Finanzas deja de liberar pedido por pedido: el pago pendiente ya deja
-- avanzar y el unico freno es RETENER. El estatus LIBERAR desaparece y los
-- pedidos que lo tenian vuelven a PAGO_PENDIENTE, que es lo que eran: nadie ha
-- confirmado su dinero.
--
-- Postgres no deja quitar un valor de un enum: el tipo se recrea sin el.

-- Primero la bitacora, mientras todavia se puede leer quien estaba en LIBERAR:
-- el cambio lo hizo el sistema, no una persona, y la nota lo explica para que
-- nadie lo confunda con una decision de Finanzas.
INSERT INTO "bitacora_pedidos"
  ("id", "pedidoId", "eje", "estadoAnterior", "estadoNuevo", "nota", "actor", "actorId", "actorNombre", "creadoEn")
SELECT gen_random_uuid()::text, p."id", 'PAGO', 'LIBERAR', 'PAGO_PENDIENTE',
       'El estatus "Liberar" dejó de existir: el pago pendiente ya deja avanzar el pedido.',
       'SISTEMA', NULL, 'Rapidix', CURRENT_TIMESTAMP
FROM "pedidos" p
WHERE p."estadoPago" = 'LIBERAR';

UPDATE "pedidos" SET "estadoPago" = 'PAGO_PENDIENTE' WHERE "estadoPago" = 'LIBERAR';

ALTER TYPE "EstadoPago" RENAME TO "EstadoPago_viejo";
CREATE TYPE "EstadoPago" AS ENUM (
  'PAGO_PENDIENTE', 'RETENER', 'CREDITO', 'REEMBOLSADO', 'PAGADO', 'CANCELADO'
);
ALTER TABLE "pedidos" ALTER COLUMN "estadoPago" DROP DEFAULT;
ALTER TABLE "pedidos" ALTER COLUMN "estadoPago" TYPE "EstadoPago"
  USING ("estadoPago"::text::"EstadoPago");
ALTER TABLE "pedidos" ALTER COLUMN "estadoPago" SET DEFAULT 'PAGO_PENDIENTE';
DROP TYPE "EstadoPago_viejo";
