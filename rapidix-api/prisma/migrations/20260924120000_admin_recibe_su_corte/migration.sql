-- El administrador puede recibir su propio corte.
--
-- La regla "quien recibe no puede ser quien cerro" sigue en pie para el resto
-- del personal, pero un negocio con un solo usuario (el administrador, que
-- reparte y cuenta) no podria recibir nunca un corte. Un CHECK no puede
-- consultar el rol de quien recibe, asi que la regla pasa a vivir solo en
-- CortesService.recibir().
ALTER TABLE "cortes" DROP CONSTRAINT "cortes_recibe_otro";
