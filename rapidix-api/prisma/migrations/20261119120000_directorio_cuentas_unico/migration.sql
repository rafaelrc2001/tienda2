-- Un solo directorio de cuentas. Antes la configuracion guardaba sus propios
-- datos de la cuenta principal y la secundaria, y el directorio
-- `cuentas_bancarias` (Finanzas -> Bancos) los repetia. Ahora el directorio
-- lleva tambien tarjeta y CLABE, y la configuracion solo apunta a dos de sus
-- cuentas.

-- 1. El directorio gana tarjeta y CLABE (opcionales).
ALTER TABLE "cuentas_bancarias" ADD COLUMN "numeroTarjeta" TEXT;
ALTER TABLE "cuentas_bancarias" ADD COLUMN "clabe" TEXT;

-- 2. La configuracion apunta a dos cuentas del directorio.
ALTER TABLE "configuracion_negocio" ADD COLUMN "cuentaPrincipalId" TEXT;
ALTER TABLE "configuracion_negocio" ADD COLUMN "cuentaSecundariaId" TEXT;

ALTER TABLE "configuracion_negocio"
  ADD CONSTRAINT "configuracion_negocio_cuentaPrincipalId_fkey"
  FOREIGN KEY ("cuentaPrincipalId") REFERENCES "cuentas_bancarias"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "configuracion_negocio"
  ADD CONSTRAINT "configuracion_negocio_cuentaSecundariaId_fkey"
  FOREIGN KEY ("cuentaSecundariaId") REFERENCES "cuentas_bancarias"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Las dos cuentas que ya estaban capturadas pasan al directorio. Si ya hay
-- una con el mismo numero de cuenta se reutiliza (y se le completan tarjeta y
-- CLABE si no las tenia); si no, se crea. Una cuenta sin numero, tarjeta ni
-- CLABE no tiene nada que pasar y se queda sin elegir. Sin numero de cuenta se
-- usa la CLABE (o la tarjeta) como numero: el directorio lo exige. Sin banco o
-- beneficiario se pone un texto que se ve a simple vista para corregirlo.
DO $$
DECLARE
  r RECORD;
  numero TEXT;
  elegida TEXT;
BEGIN
  FOR r IN
    SELECT 'principal' AS cual, "banco" AS banco, "beneficiario" AS beneficiario,
           "numeroCuenta" AS num, "numeroTarjeta" AS tarjeta, "clabe" AS clabe
      FROM "configuracion_negocio" WHERE "id" = 1
    UNION ALL
    SELECT 'secundaria', "bancoSecundaria", "beneficiarioSecundaria",
           "numeroCuentaSecundaria", "numeroTarjetaSecundaria", "clabeSecundaria"
      FROM "configuracion_negocio" WHERE "id" = 1
  LOOP
    numero := COALESCE(
      NULLIF(regexp_replace(COALESCE(r.num, ''), '\D', '', 'g'), ''),
      NULLIF(r.clabe, ''),
      NULLIF(r.tarjeta, '')
    );
    CONTINUE WHEN numero IS NULL;

    SELECT "id" INTO elegida FROM "cuentas_bancarias"
      WHERE "numeroCuenta" = numero ORDER BY "creadoEn" LIMIT 1;

    IF elegida IS NULL THEN
      elegida := gen_random_uuid()::text;
      INSERT INTO "cuentas_bancarias"
        ("id", "banco", "numeroCuenta", "titular", "numeroTarjeta", "clabe")
      VALUES (
        elegida,
        COALESCE(NULLIF(trim(r.banco), ''), 'Sin banco'),
        numero,
        COALESCE(NULLIF(trim(r.beneficiario), ''), 'Sin titular'),
        NULLIF(r.tarjeta, ''),
        NULLIF(r.clabe, '')
      );
    ELSE
      UPDATE "cuentas_bancarias"
        SET "numeroTarjeta" = COALESCE("numeroTarjeta", NULLIF(r.tarjeta, '')),
            "clabe" = COALESCE("clabe", NULLIF(r.clabe, ''))
        WHERE "id" = elegida;
    END IF;

    IF r.cual = 'principal' THEN
      UPDATE "configuracion_negocio" SET "cuentaPrincipalId" = elegida WHERE "id" = 1;
    ELSE
      UPDATE "configuracion_negocio" SET "cuentaSecundariaId" = elegida WHERE "id" = 1;
    END IF;
  END LOOP;
END $$;

-- 4. Los datos propios de la configuracion ya viven en el directorio.
ALTER TABLE "configuracion_negocio" DROP COLUMN "banco";
ALTER TABLE "configuracion_negocio" DROP COLUMN "beneficiario";
ALTER TABLE "configuracion_negocio" DROP COLUMN "numeroCuenta";
ALTER TABLE "configuracion_negocio" DROP COLUMN "numeroTarjeta";
ALTER TABLE "configuracion_negocio" DROP COLUMN "clabe";
ALTER TABLE "configuracion_negocio" DROP COLUMN "bancoSecundaria";
ALTER TABLE "configuracion_negocio" DROP COLUMN "beneficiarioSecundaria";
ALTER TABLE "configuracion_negocio" DROP COLUMN "numeroCuentaSecundaria";
ALTER TABLE "configuracion_negocio" DROP COLUMN "numeroTarjetaSecundaria";
ALTER TABLE "configuracion_negocio" DROP COLUMN "clabeSecundaria";
