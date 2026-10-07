-- Punto de venta: un turno abierto por cajero **y por tienda**.
--
-- El PDV se mira siempre desde una tienda, y cada una lleva su caja: su turno,
-- sus pedidos y su corte. Con el indice anterior —un turno abierto por
-- cajero, en cualquier tienda— quien atiende dos tiendas no podia abrir la
-- segunda sin cerrar la primera.
--
-- No hace falta tocar datos: quien tenia un turno abierto lo sigue teniendo, y
-- relajar la regla no puede dejar filas que la incumplan.

DROP INDEX "turnos_pdv_uno_abierto";

CREATE UNIQUE INDEX "turnos_pdv_uno_abierto_por_tienda" ON "turnos_pdv"("cajeroId", "tiendaId") WHERE "cerradoEn" IS NULL;
