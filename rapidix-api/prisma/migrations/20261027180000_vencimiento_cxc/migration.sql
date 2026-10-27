-- El plazo de cada cuenta por cobrar, congelado al entrar a CXC: vence el dia
-- de "cxcDesde" mas estos dias. Las que ya estan en CXC toman el plazo que hoy
-- tiene su cliente; sin plazo quedan en null y no vencen.
ALTER TABLE "pedidos" ADD COLUMN "diasCredito" INTEGER;

UPDATE "pedidos" p
SET "diasCredito" = c."diasCredito"
FROM "clientes" c
WHERE p."clienteId" = c.id
  AND p."cxcDesde" IS NOT NULL;
