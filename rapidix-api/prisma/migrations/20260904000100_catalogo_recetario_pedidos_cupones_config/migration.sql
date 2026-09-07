-- CreateEnum
CREATE TYPE "OrigenReceta" AS ENUM ('RECETARIO', 'PROPIA', 'COMUNIDAD');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('CONFIRMADO', 'EN_RUTA', 'ENTREGADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoDescuento" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "EstadoCupon" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrigenCupon" AS ENUM ('LIFECYCLE', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "TipoAudiencia" AS ENUM ('ALL', 'NEW_CUSTOMERS', 'EXISTING_CUSTOMERS', 'SOURCE', 'REFERRAL', 'SEGMENT');

-- CreateEnum
CREATE TYPE "TipoFuente" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'INFLUENCER', 'QR', 'REFERIDO', 'GOOGLE', 'OTRO');

-- CreateTable
CREATE TABLE "productos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "precioCosto" DECIMAL(12,2) NOT NULL,
    "precioVenta" DECIMAL(12,2) NOT NULL,
    "imagenUrl" TEXT,
    "emoji" TEXT,
    "agotado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_producto" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recetas" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tiempo" TEXT NOT NULL,
    "porciones" INTEGER NOT NULL,
    "imagenUrl" TEXT,
    "emoji" TEXT,
    "youtube" TEXT,
    "categorias" TEXT[],
    "autorNombre" TEXT NOT NULL,
    "autorClienteId" TEXT,
    "origin" "OrigenReceta" NOT NULL,
    "compartir" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receta_ingredientes" (
    "id" TEXT NOT NULL,
    "recetaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidad" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "receta_ingredientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receta_pasos" (
    "id" TEXT NOT NULL,
    "recetaId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "receta_pasos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recetas_guardadas" (
    "clienteId" TEXT NOT NULL,
    "recetaId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recetas_guardadas_pkey" PRIMARY KEY ("clienteId","recetaId")
);

-- CreateTable
CREATE TABLE "recetas_pausadas" (
    "clienteId" TEXT NOT NULL,
    "recetaId" TEXT NOT NULL,
    "pausadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recetas_pausadas_pkey" PRIMARY KEY ("clienteId")
);

-- CreateTable
CREATE TABLE "recetas_cocinadas" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "recetaId" TEXT NOT NULL,
    "cocinadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recetas_cocinadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recetas_calificaciones" (
    "clienteId" TEXT NOT NULL,
    "recetaId" TEXT NOT NULL,
    "puntuacion" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recetas_calificaciones_pkey" PRIMARY KEY ("clienteId","recetaId")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "envio" DECIMAL(12,2) NOT NULL,
    "recargoFuera" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "cashbackGenerado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'CONFIRMADO',
    "direccion" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_items" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "pedido_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cupones_ciclo_vida" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "customerMessage" TEXT NOT NULL,
    "discountType" "TipoDescuento" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "minimumOrderAmount" DECIMAL(12,2) NOT NULL,
    "maximumOrderAmount" DECIMAL(12,2),
    "validityDays" INTEGER NOT NULL,
    "usageLimitPerCustomer" INTEGER NOT NULL,
    "inactivityDays" INTEGER,
    "birthdayWindowDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cupones_ciclo_vida_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "campanias" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "customerMessage" TEXT,
    "discountType" "TipoDescuento" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "minimumOrderAmount" DECIMAL(12,2) NOT NULL,
    "maximumOrderAmount" DECIMAL(12,2),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "usageLimitTotal" INTEGER NOT NULL DEFAULT 0,
    "usageLimitPerCustomer" INTEGER NOT NULL DEFAULT 1,
    "targetType" "TipoAudiencia" NOT NULL DEFAULT 'ALL',
    "sourceCode" TEXT,
    "segmentRules" JSONB NOT NULL DEFAULT '[]',
    "categorias" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campanias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cupones_emitidos" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "sourceKind" "OrigenCupon" NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "customerMessage" TEXT,
    "discountType" "TipoDescuento" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "minimumOrderAmount" DECIMAL(12,2) NOT NULL,
    "maximumOrderAmount" DECIMAL(12,2),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "EstadoCupon" NOT NULL DEFAULT 'ACTIVE',
    "usedAt" TIMESTAMP(3),
    "usedPedidoId" TEXT,
    "discountApplied" DECIMAL(12,2),

    CONSTRAINT "cupones_emitidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuentes_adquisicion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TipoFuente" NOT NULL DEFAULT 'OTRO',
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuentes_adquisicion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_negocio" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "diasServicio" JSONB NOT NULL,
    "abre" TEXT NOT NULL,
    "cierra" TEXT NOT NULL,
    "atenderFuera" BOOLEAN NOT NULL,
    "incrementoFuera" DECIMAL(5,2) NOT NULL,
    "whatsappAyuda" TEXT,
    "costoEnvio" DECIMAL(12,2) NOT NULL,
    "montoEnvioGratis" DECIMAL(12,2) NOT NULL,
    "multiplicadorCashback" DECIMAL(6,2) NOT NULL,
    "montoMinimoCashback" DECIMAL(12,2) NOT NULL,
    "banco" TEXT,
    "beneficiario" TEXT,
    "numeroCuenta" TEXT,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "niveles_fidelidad" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "umbralGasto" DECIMAL(12,2) NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "niveles_fidelidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_cashback" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "pedidoId" TEXT,
    "monto" DECIMAL(12,2) NOT NULL,
    "concepto" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_cashback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "noticias_destacadas" (
    "id" TEXT NOT NULL,
    "badge" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "publicadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "noticias_destacadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avisos" (
    "id" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "publicadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecturas_destacados" (
    "clienteId" TEXT NOT NULL,
    "ultimaLectura" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lecturas_destacados_pkey" PRIMARY KEY ("clienteId")
);

-- CreateIndex
CREATE INDEX "productos_categoria_idx" ON "productos"("categoria");

-- CreateIndex
CREATE INDEX "solicitudes_producto_productoId_idx" ON "solicitudes_producto"("productoId");

-- CreateIndex
CREATE INDEX "solicitudes_producto_clienteId_idx" ON "solicitudes_producto"("clienteId");

-- CreateIndex
CREATE INDEX "recetas_origin_idx" ON "recetas"("origin");

-- CreateIndex
CREATE INDEX "recetas_autorClienteId_idx" ON "recetas"("autorClienteId");

-- CreateIndex
CREATE INDEX "receta_ingredientes_recetaId_idx" ON "receta_ingredientes"("recetaId");

-- CreateIndex
CREATE INDEX "receta_pasos_recetaId_idx" ON "receta_pasos"("recetaId");

-- CreateIndex
CREATE INDEX "recetas_cocinadas_clienteId_cocinadaEn_idx" ON "recetas_cocinadas"("clienteId", "cocinadaEn");

-- CreateIndex
CREATE INDEX "recetas_calificaciones_recetaId_idx" ON "recetas_calificaciones"("recetaId");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_folio_key" ON "pedidos"("folio");

-- CreateIndex
CREATE INDEX "pedidos_clienteId_creadoEn_idx" ON "pedidos"("clienteId", "creadoEn");

-- CreateIndex
CREATE INDEX "pedido_items_pedidoId_idx" ON "pedido_items"("pedidoId");

-- CreateIndex
CREATE UNIQUE INDEX "campanias_name_key" ON "campanias"("name");

-- CreateIndex
CREATE INDEX "campanias_isActive_startsAt_endsAt_idx" ON "campanias"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "cupones_emitidos_code_key" ON "cupones_emitidos"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cupones_emitidos_usedPedidoId_key" ON "cupones_emitidos"("usedPedidoId");

-- CreateIndex
CREATE INDEX "cupones_emitidos_clienteId_status_idx" ON "cupones_emitidos"("clienteId", "status");

-- CreateIndex
CREATE INDEX "cupones_emitidos_sourceKind_sourceCode_status_idx" ON "cupones_emitidos"("sourceKind", "sourceCode", "status");

-- CreateIndex
CREATE INDEX "cupones_emitidos_status_expiresAt_idx" ON "cupones_emitidos"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "fuentes_adquisicion_code_key" ON "fuentes_adquisicion"("code");

-- CreateIndex
CREATE UNIQUE INDEX "niveles_fidelidad_nombre_key" ON "niveles_fidelidad"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "niveles_fidelidad_orden_key" ON "niveles_fidelidad"("orden");

-- CreateIndex
CREATE INDEX "movimientos_cashback_clienteId_creadoEn_idx" ON "movimientos_cashback"("clienteId", "creadoEn");

-- CreateIndex
CREATE INDEX "noticias_destacadas_publicadoEn_idx" ON "noticias_destacadas"("publicadoEn");

-- CreateIndex
CREATE INDEX "avisos_publicadoEn_idx" ON "avisos"("publicadoEn");

-- CreateIndex
CREATE INDEX "clientes_ciudad_idx" ON "clientes"("ciudad");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_nivelId_fkey" FOREIGN KEY ("nivelId") REFERENCES "niveles_fidelidad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_producto" ADD CONSTRAINT "solicitudes_producto_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_producto" ADD CONSTRAINT "solicitudes_producto_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_autorClienteId_fkey" FOREIGN KEY ("autorClienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_ingredientes" ADD CONSTRAINT "receta_ingredientes_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "recetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_pasos" ADD CONSTRAINT "receta_pasos_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "recetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas_guardadas" ADD CONSTRAINT "recetas_guardadas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas_guardadas" ADD CONSTRAINT "recetas_guardadas_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "recetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas_pausadas" ADD CONSTRAINT "recetas_pausadas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas_pausadas" ADD CONSTRAINT "recetas_pausadas_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "recetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas_cocinadas" ADD CONSTRAINT "recetas_cocinadas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas_cocinadas" ADD CONSTRAINT "recetas_cocinadas_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "recetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas_calificaciones" ADD CONSTRAINT "recetas_calificaciones_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas_calificaciones" ADD CONSTRAINT "recetas_calificaciones_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "recetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_items" ADD CONSTRAINT "pedido_items_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_items" ADD CONSTRAINT "pedido_items_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupones_emitidos" ADD CONSTRAINT "cupones_emitidos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupones_emitidos" ADD CONSTRAINT "cupones_emitidos_usedPedidoId_fkey" FOREIGN KEY ("usedPedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cashback" ADD CONSTRAINT "movimientos_cashback_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_cashback" ADD CONSTRAINT "movimientos_cashback_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecturas_destacados" ADD CONSTRAINT "lecturas_destacados_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

