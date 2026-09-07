-- Secuencia para el folio legible de los pedidos (ORD-000001).
-- Se usa una secuencia de Postgres y no un COUNT(*)+1 porque dos pedidos
-- simultaneos generarian el mismo folio y chocarian contra el UNIQUE.
CREATE SEQUENCE IF NOT EXISTS pedidos_folio_seq START WITH 1 INCREMENT BY 1;
