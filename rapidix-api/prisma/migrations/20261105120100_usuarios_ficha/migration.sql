-- Ficha del personal: nombre de usuario, apellidos, fecha de ingreso y tienda.
--
-- El personal deja de entrar con email y entra con un nombre de usuario que se
-- le da en Configuracion -> Usuarios. Siembra: a las cuentas que ya existen se
-- les pone de usuario su propio email (en minusculas), asi que siguen entrando
-- con lo mismo que tecleaban antes. El email se queda, ya opcional.

ALTER TABLE "usuarios" ADD COLUMN "usuario" TEXT;
ALTER TABLE "usuarios" ADD COLUMN "apellidos" TEXT NOT NULL DEFAULT '';
ALTER TABLE "usuarios" ADD COLUMN "fechaIngreso" DATE;
ALTER TABLE "usuarios" ADD COLUMN "tiendaId" TEXT;

UPDATE "usuarios" SET "usuario" = lower("email");

ALTER TABLE "usuarios" ALTER COLUMN "usuario" SET NOT NULL;
ALTER TABLE "usuarios" ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "usuarios_usuario_key" ON "usuarios"("usuario");

-- Las tiendas no se borran (se apagan); si alguna llegara a borrarse el
-- usuario se queda sin tienda en vez de impedirlo.
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "tiendas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cuentas de prueba, una por rol, todas con contrasena "123" (hash argon2id).
-- Son para probar el acceso de cada rol: se desactivan o se cambian desde
-- Configuracion -> Usuarios antes de usar la app con gente de fuera.
-- ON CONFLICT: si ya hay alguien con ese usuario no se toca.
-- La de PDV queda en la primera tienda activa, si hay alguna.
INSERT INTO "usuarios" ("id", "usuario", "passwordHash", "nombre", "apellidos", "fechaIngreso", "rol", "tiendaId", "actualizadoEn")
VALUES
  (gen_random_uuid()::text, 'administrador', '$argon2id$v=19$m=65536,p=4,t=3$0v0qEHFrh80kq+9lkmpaEg$48DK1e9Ld45/9KdrdiLz/S8R0+36Umc9GPGQsmVEI0o', 'Administrador', 'Prueba', CURRENT_DATE, 'ADMINISTRADOR', NULL, now()),
  (gen_random_uuid()::text, 'ruta', '$argon2id$v=19$m=65536,p=4,t=3$0v0qEHFrh80kq+9lkmpaEg$48DK1e9Ld45/9KdrdiLz/S8R0+36Umc9GPGQsmVEI0o', 'Ruta', 'Prueba', CURRENT_DATE, 'RUTA', NULL, now()),
  (gen_random_uuid()::text, 'operaciones', '$argon2id$v=19$m=65536,p=4,t=3$0v0qEHFrh80kq+9lkmpaEg$48DK1e9Ld45/9KdrdiLz/S8R0+36Umc9GPGQsmVEI0o', 'Operaciones', 'Prueba', CURRENT_DATE, 'OPERACIONES', NULL, now()),
  (gen_random_uuid()::text, 'finanzas', '$argon2id$v=19$m=65536,p=4,t=3$0v0qEHFrh80kq+9lkmpaEg$48DK1e9Ld45/9KdrdiLz/S8R0+36Umc9GPGQsmVEI0o', 'Finanzas', 'Prueba', CURRENT_DATE, 'FINANZAS', NULL, now()),
  (gen_random_uuid()::text, 'pdv', '$argon2id$v=19$m=65536,p=4,t=3$0v0qEHFrh80kq+9lkmpaEg$48DK1e9Ld45/9KdrdiLz/S8R0+36Umc9GPGQsmVEI0o', 'PDV', 'Prueba', CURRENT_DATE, 'PDV',
    (SELECT "id" FROM "tiendas" WHERE "activa" ORDER BY "nombre" LIMIT 1), now())
ON CONFLICT ("usuario") DO NOTHING;
