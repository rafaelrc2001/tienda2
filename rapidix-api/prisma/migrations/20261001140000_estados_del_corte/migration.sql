-- Cortes de ruta: los estatus que ve Finanzas.
--
-- Hasta hoy un corte nacia CERRADO (el repartidor liquido) y acababa RECIBIDO
-- (Finanzas conto el dinero). El negocio lo nombra de otra forma y con un paso
-- mas: LIQUIDADO -> ACEPTADO -> CERRADO, donde CERRADO es el final: aceptado y
-- sin que el repartidor deba nada.
--
-- Aqui solo cambian los nombres; nadie usa todavia el CERRADO nuevo:
--   CERRADO  -> LIQUIDADO   el repartidor liquido y Finanzas tiene algo por aceptar
--   RECIBIDO -> ACEPTADO    Finanzas lo acepto
--   (nuevo)     CERRADO     aceptado y sin adeudo
--
-- Renombrar no toca las filas, ni el DEFAULT de la columna, ni el CHECK
-- `cortes_recepcion_completa`: los tres guardan el valor, no su nombre, asi que
-- siguen diciendo lo mismo con el nombre nuevo.
--
-- El valor nuevo se usa en la migracion siguiente y no en esta: Postgres no
-- deja usar un valor de enum en la misma transaccion que lo crea.

ALTER TYPE "EstadoCorte" RENAME VALUE 'CERRADO' TO 'LIQUIDADO';
ALTER TYPE "EstadoCorte" RENAME VALUE 'RECIBIDO' TO 'ACEPTADO';
ALTER TYPE "EstadoCorte" ADD VALUE 'CERRADO';
