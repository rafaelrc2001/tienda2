-- Finanzas -> Bancos: el estado de cuenta de cada cuenta bancaria del negocio,
-- por meses. Un periodo es un mes de una cuenta; sus movimientos llevan signo
-- (lo que entra en positivo, lo que sale en negativo).
--
-- Solo el primer periodo de cada cuenta guarda saldo (`saldoApertura`): los
-- demas heredan en vivo el saldo final del anterior.
CREATE TABLE "periodos_bancarios" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "saldoApertura" DECIMAL(12,2),
    "abiertoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "periodos_bancarios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "periodos_bancarios_mes_check" CHECK ("mes" BETWEEN 1 AND 12)
);

CREATE TABLE "movimientos_bancarios" (
    "id" TEXT NOT NULL,
    "periodoId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "factura" TEXT,
    "cantidad" DECIMAL(12,2) NOT NULL,
    "metodo" "MetodoPago" NOT NULL,
    "referencia" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_bancarios_pkey" PRIMARY KEY ("id"),
    -- Un movimiento en cero no mueve nada: no es un renglon del estado de cuenta.
    CONSTRAINT "movimientos_bancarios_cantidad_check" CHECK ("cantidad" <> 0)
);

-- Un mes de una cuenta se abre una sola vez.
CREATE UNIQUE INDEX "periodos_bancarios_cuentaId_anio_mes_key" ON "periodos_bancarios"("cuentaId", "anio", "mes");

CREATE INDEX "movimientos_bancarios_periodoId_fecha_idx" ON "movimientos_bancarios"("periodoId", "fecha");

-- Una cuenta con periodos no se borra: se perderia su historia.
ALTER TABLE "periodos_bancarios" ADD CONSTRAINT "periodos_bancarios_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "cuentas_bancarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "periodos_bancarios" ADD CONSTRAINT "periodos_bancarios_abiertoPorId_fkey" FOREIGN KEY ("abiertoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "movimientos_bancarios" ADD CONSTRAINT "movimientos_bancarios_periodoId_fkey" FOREIGN KEY ("periodoId") REFERENCES "periodos_bancarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "movimientos_bancarios" ADD CONSTRAINT "movimientos_bancarios_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
