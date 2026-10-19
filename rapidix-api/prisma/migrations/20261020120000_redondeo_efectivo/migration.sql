-- Redondeo del efectivo: lo que se cobra en efectivo va en pesos enteros, hacia
-- arriba, porque ni el repartidor ni la caja dan cambio en centavos.
--
-- La diferencia se guarda aparte para poder auditarla y ya va sumada en
-- `total`. Cero en lo que ya existia: esos pedidos se cobraron sin redondeo.

ALTER TABLE "pedidos"
    ADD COLUMN "redondeo" DECIMAL(12,2) NOT NULL DEFAULT 0;
