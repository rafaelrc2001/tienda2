-- Las listas de precio ya no tienen que ir de mas cara a mas barata.
--
-- Los CHECK exigian `precio2 < precioVenta` y `precio3 < precio2`. El negocio
-- pone el precio de cada lista como le conviene: una lista puede costar igual
-- o mas que la anterior, y con la restriccion no se podia actualizar el precio
-- de venta sin tocar antes las otras dos.
--
-- Se conserva lo que si es una regla: que el precio no sea negativo. Los
-- pisos siguen teniendo que subir (`productos_lista2_piso`, `_lista3_piso`).
-- Solo se aflojan restricciones: ninguna fila existente deja de cumplir.

ALTER TABLE "productos"
    DROP CONSTRAINT "productos_lista2_precio",
    DROP CONSTRAINT "productos_lista3_precio";

ALTER TABLE "productos"
    ADD CONSTRAINT "productos_lista2_precio" CHECK ("precio2" IS NULL OR "precio2" >= 0),
    ADD CONSTRAINT "productos_lista3_precio" CHECK ("precio3" IS NULL OR "precio3" >= 0);
