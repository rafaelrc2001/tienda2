-- Precio pactado por pedido: Finanzas puede cobrarle a un cliente un producto a
-- otro precio que el de la lista, solo en ese pedido.
--
-- `precioUnitario` pasa a ser el precio nuevo y aqui queda el que tenia al
-- venderse. Nula en lo que ya existia: ningun precio se cambio a mano.

ALTER TABLE "pedido_items"
    ADD COLUMN "precioOriginal" DECIMAL(25,15);
