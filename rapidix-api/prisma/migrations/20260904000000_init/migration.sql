-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ADMINISTRADOR', 'RUTA', 'OPERACIONES', 'FINANZAS');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT,
    "telefono" TEXT NOT NULL,
    "fechaNacimiento" TIMESTAMP(3),
    "quienRecibe" TEXT,
    "calle" TEXT,
    "colonia" TEXT,
    "cp" TEXT,
    "ciudad" TEXT,
    "estado" TEXT,
    "referencias" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "fuenteCodigo" TEXT,
    "notificaciones" BOOLEAN NOT NULL DEFAULT true,
    "saldoCashback" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "nivelId" TEXT,
    "pedidos" INTEGER NOT NULL DEFAULT 0,
    "totalGastado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "primerPedido" TIMESTAMP(3),
    "ultimoPedido" TIMESTAMP(3),
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigos_otp" (
    "id" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "consumidoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_otp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_telefono_key" ON "clientes"("telefono");

-- CreateIndex
CREATE INDEX "clientes_ultimoPedido_idx" ON "clientes"("ultimoPedido");

-- CreateIndex
CREATE INDEX "codigos_otp_telefono_expiraEn_idx" ON "codigos_otp"("telefono", "expiraEn");

