-- La sucursal del cliente pasa de texto libre a una de las tiendas dadas de alta.
--
-- Antes se tecleaba a mano porque no habia catalogo de sucursales. Ahora se
-- elige de la lista de tiendas en Mi Perfil y el carrito la propone al recoger
-- en tienda, asi que tiene que apuntar a una tienda de verdad.
--
-- Siembra: lo ya escrito se conserva si coincide con el nombre de una tienda
-- (sin importar mayusculas ni espacios). Lo que no coincide no apunta a ninguna
-- tienda y se pierde: el cliente la vuelve a elegir de la lista.

ALTER TABLE "clientes" ADD COLUMN "tiendaId" TEXT;
ALTER TABLE "prospectos" ADD COLUMN "tiendaId" TEXT;

UPDATE "clientes" c
SET "tiendaId" = t."id"
FROM "tiendas" t
WHERE c."sucursal" IS NOT NULL
  AND lower(trim(c."sucursal")) = lower(trim(t."nombre"));

UPDATE "prospectos" p
SET "tiendaId" = t."id"
FROM "tiendas" t
WHERE p."sucursal" IS NOT NULL
  AND lower(trim(p."sucursal")) = lower(trim(t."nombre"));

ALTER TABLE "clientes" DROP COLUMN "sucursal";
ALTER TABLE "prospectos" DROP COLUMN "sucursal";

-- Las tiendas no se borran (se apagan), pero si alguna llegara a borrarse el
-- cliente se queda sin sucursal en vez de impedirlo.
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "tiendas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prospectos" ADD CONSTRAINT "prospectos_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "tiendas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
