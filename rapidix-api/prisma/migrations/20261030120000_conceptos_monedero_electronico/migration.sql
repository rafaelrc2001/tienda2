-- El concepto para el cliente se llama "Monedero electronico". Los movimientos
-- guardan su texto ya armado, asi que sin esto el estado de cuenta mezclaria
-- "Cashback del pedido..." en los viejos con el nombre nuevo en los recientes.
-- Solo cambia el texto: ni montos ni saldos.
UPDATE "movimientos_cashback"
SET "concepto" = regexp_replace("concepto", 'cashback|billetera', 'Monedero electrónico', 'gi')
WHERE "concepto" ~* 'cashback|billetera';
