-- Rol nuevo: cajero de una tienda (PDV).
--
-- Va solo en su migracion: Postgres no deja usar un valor de enum en la misma
-- transaccion en que se crea, y la siguiente migracion ya da de alta una
-- cuenta con este rol.

ALTER TYPE "RolUsuario" ADD VALUE IF NOT EXISTS 'PDV';
