-- El folio es la referencia de la transferencia y algunos bancos no aceptan guiones
-- en ese campo: pasa de ORD-000001 a ORD000001. Se reescriben los folios existentes
-- para que todos los pedidos tengan el mismo formato (no colisionan: solo se quita
-- el guion y el numero sigue siendo el de la secuencia).
UPDATE "pedidos" SET "folio" = REPLACE("folio", 'ORD-', 'ORD') WHERE "folio" LIKE 'ORD-%';
