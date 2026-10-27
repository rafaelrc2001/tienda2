-- Clientes con credito: sus pedidos de la app nacen en CREDITO. Todos los
-- clientes de hoy nacen sin credito; el plazo en dias se captura despues.
ALTER TABLE "clientes" ADD COLUMN "credito" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clientes" ADD COLUMN "diasCredito" INTEGER;
