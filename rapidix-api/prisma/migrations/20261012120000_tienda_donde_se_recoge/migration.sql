-- La tienda donde se recoge un pedido de la app.
--
-- Hasta ahora «Recoger en tienda» no decia en cual: el pedido lo surtia
-- bodega desde Operaciones. Ahora el cliente elige la tienda en el carrito y
-- el pedido queda atado a ella: lo prepara y lo entrega esa tienda desde la
-- pestana Operaciones de su PDV, y la mercancia sale de su inventario.
--
-- Todo aditivo y sin siembra: los pedidos que ya existen se quedan en null y
-- siguen su camino de siempre por Operaciones. Los capturados en mostrador
-- tampoco la llevan: de esos la tienda la dice su turno (`turnoId`).

ALTER TABLE "pedidos" ADD COLUMN "tiendaId" TEXT;
CREATE INDEX "pedidos_tiendaId_idx" ON "pedidos"("tiendaId");
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "tiendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Solo se recoge en una tienda lo que se pidio para recoger.
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_tienda_solo_al_recoger" CHECK (
  "tiendaId" IS NULL OR "metodoEntrega" = 'TIENDA'
);
