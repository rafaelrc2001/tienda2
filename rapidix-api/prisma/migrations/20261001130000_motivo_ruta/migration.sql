-- Inventario: la mercancia sale del fisico al recolectarse, no al entregarse.
--
-- Hasta hoy el fisico bajaba cuando el cliente recibia el pedido, asi que lo
-- que iba arriba de un camion seguia contando como si estuviera en el estante.
-- Ahora recolectar lo saca del fisico y lo pasa a `inventarioEnRuta`, y lo que
-- regresa vuelve a entrar. Motivo propio para que la bitacora distinga "salio a
-- ruta" y "regreso de ruta" de la entrega en tienda (ENTREGA) y de la
-- cancelacion (DEVOLUCION).
--
-- No hace falta siembra: las cuentas se deducen de los movimientos ya escritos
-- de cada pedido. Uno recolectado antes de esto no tiene salida RUTA, saca su
-- fisico al entregarse con ENTREGA como siempre y no devuelve nada en el corte.

ALTER TYPE "MotivoMovimiento" ADD VALUE 'RUTA';
