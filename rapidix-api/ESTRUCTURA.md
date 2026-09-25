# Estructura de `rapidix-api`

Mapa archivo por archivo del backend. Para el *por qué* de las decisiones de
negocio, el [README](README.md); esto es el *dónde está cada cosa*.

**Stack:** NestJS 11 · TypeScript 5.7 · Prisma 6 · PostgreSQL 16 · Node 22

---

## Índice

- [Raíz del proyecto](#raíz-del-proyecto)
- [`prisma/` — esquema, migraciones y datos iniciales](#prisma--esquema-migraciones-y-datos-iniciales)
- [`src/` — arranque](#src--arranque)
- [`src/auth/` — autenticación y permisos](#srcauth--autenticación-y-permisos)
- [`src/prisma/` — cliente de base de datos](#srcprisma--cliente-de-base-de-datos)
- [`src/notifications/` — envío a WhatsApp](#srcnotifications--envío-a-whatsapp)
- [`src/admin/` — menú del panel](#srcadmin--menú-del-panel)
- [`src/catalogo/` — productos y categorías](#srccatalogo--productos-y-categorías)
- [`src/inventario/` — bodega y bitácora](#srcinventario--bodega-y-bitácora)
- [`src/clientes/` — perfil, clientes y prospectos](#srcclientes--perfil-clientes-y-prospectos)
- [`src/pedidos/` — carrito y checkout](#srcpedidos--carrito-y-checkout)
- [`src/cupones/` — motor de cupones](#srccupones--motor-de-cupones)
- [`src/cashback/` — saldo y niveles](#srccashback--saldo-y-niveles)
- [`src/recetario/` — recetas](#srcrecetario--recetas)
- [`src/configuracion/` — parámetros del negocio](#srcconfiguracion--parámetros-del-negocio)
- [`src/uploads/` — imágenes](#srcuploads--imágenes)
- [`src/health/` — healthcheck](#srchealth--healthcheck)
- [`src/types/` — tipos globales](#srctypes--tipos-globales)
- [Patrones que se repiten](#patrones-que-se-repiten)

---

## Raíz del proyecto

| Archivo | Qué contiene |
| --- | --- |
| [package.json](package.json) | Dependencias y scripts. `start:dev` (watch), `prisma:seed`, `prisma:migrate`. `postinstall` corre `prisma generate`. Declara Node 22 y la config de Jest (`rootDir: src`, `*.spec.ts`). |
| [tsconfig.json](tsconfig.json) | TypeScript en modo estricto: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`. Decoradores activados (los necesita Nest). |
| [tsconfig.build.json](tsconfig.build.json) | El anterior, excluyendo `prisma/`, `test/` y los `*.spec.ts` de la compilación. |
| [nest-cli.json](nest-cli.json) | Config del CLI. Activa el plugin de Swagger con `introspectComments`: los comentarios JSDoc de los controladores se convierten solos en descripciones de `/docs`. |
| [railway.json](railway.json) | Despliegue: build `prisma generate && npm run build`, arranque `prisma migrate deploy && node dist/main.js`, healthcheck en `/health`, reinicio ante fallo (máx. 5). |
| [nixpacks.toml](nixpacks.toml) | Añade `python3` y `build-essential` al builder, por si `argon2` no encuentra binario precompilado y tiene que compilar con node-gyp. |
| [Procfile](Procfile) | El mismo comando de arranque, para plataformas que leen Procfile. |
| [docker-compose.yml](docker-compose.yml) | Postgres 16-alpine para desarrollo local, con las credenciales que ya trae `.env.example` y un healthcheck con `pg_isready`. |
| [.env.example](.env.example) | Plantilla de variables, con comentarios sobre qué desbloquea cada interruptor de demo y qué riesgo asume. |
| [.nvmrc](.nvmrc) | Node 22. |
| [.prettierrc](.prettierrc) | Comillas simples, comas finales, 100 columnas. |
| [.gitignore](.gitignore) | `node_modules`, `dist`, `coverage`, `.env*`, `*.tsbuildinfo`. |
| [README.md](README.md) | Arranque, tabla de variables, despliegue, la distinción cliente/prospecto y las decisiones de negocio que conviene conocer antes de tocar el código. |

---

## `prisma/` — esquema, migraciones y datos iniciales

### [schema.prisma](prisma/schema.prisma)

27 modelos y 11 enums. Agrupados por dominio:

**Identidad y acceso**
- `Usuario` — personal del negocio: email, `passwordHash` (argon2id), rol, activo.
- `Cliente` — quien ya compró. Datos personales, dirección con `lat`/`lng`, contadores (`pedidos`, `totalGastado`, `primerPedido`, `ultimoPedido`), `saldoCashback`, `nivelId`, `fuenteCodigo`.
- `Prospecto` — quien se registró y aún no compró. Los mismos campos de perfil, sin contadores de compra.
- `CodigoOtp` — códigos de login: `codigoHash`, `expiraEn`, `intentos`, `consumidoEn`.
- `enum RolUsuario` — ADMINISTRADOR, RUTA, OPERACIONES, FINANZAS.

**Catálogo**
- `Categoria` — catálogo de categorías, nombre único.
- `Producto` — nombre, `categoriaId`, unidad, `precioCosto`, `precioVenta` (Decimal), `imagenUrl`, `agotado`, y los dos saldos de bodega: `inventario` (lo físico) y `aptInventario` (lo liberado para venta). No tienen por qué coincidir: la mercancía en cuarentena ya llegó pero aún no se vende.
- `SolicitudProducto` — el botón «Programar» de un producto agotado.
- `MovimientoInventario` — la bitácora de bodega. Cada fila **congela los cuatro saldos** (antes/después × físico/apt) del instante en que se aplicó, así que se explica sola aunque alguien mueva el mismo producto un segundo después.
- Enums: `TipoMovimiento` (ENTRADA/SALIDA), `AfectaInventario` (AMBOS/FISICO/APT) y `MotivoMovimiento` (COMPRA, VENTA, MERMA, TRASPASO, AJUSTE, DEVOLUCION) — catálogo cerrado a propósito: con texto libre no se puede agrupar por causa.

**Imágenes**
- `Imagen` — los bytes de una foto de producto o receta, en un `bytea`. Solo se llena en los entornos sin bucket S3: es lo que permite subir fotos sin tener contratado uno. Ver [`src/uploads/`](#srcuploads--imágenes).

**Recetario**
- `Receta` — nombre, tiempo, porciones, imagen, emoji, YouTube, `categorias[]`, autor, `origin`, `compartir`.
- `RecetaIngrediente`, `RecetaPaso` — listas ordenadas que cuelgan de la receta.
- `RecetaGuardada`, `RecetaCocinada`, `RecetaCalificacion` — estado por cliente.
- `RecetaPausada` — **`clienteId` es la clave primaria**: por esquema, un cliente no puede tener dos recetas en pausa.
- `enum OrigenReceta` — RECETARIO (oficial) / PROPIA (del cliente).

**Pedidos**
- `Pedido` — folio, cliente, `subtotal`/`envio`/`recargoFuera`/`descuento`/`total`/`cashbackGenerado` (todos Decimal), dos ejes de estatus (`estado` y `estadoPago`), dirección congelada en JSON. El cashback se congela al crearlo (`cashbackGenerado`, `porcentajeCashback`) y se acredita al pagarse (`cashbackAcreditadoEn`).
- `PedidoItem` — nombre, categoría, unidad y precio **copiados** al momento de la compra, para que editar el producto no reescriba el historial.
- `enum EstadoPedido` — eje físico: `CONFIRMADO → EN_PREPARACION → PREPARADO → LISTO_PARA_ENTREGA → RECOLECTADO → EN_RUTA → ENTREGADO`. No tiene cancelado.
- `enum EstadoPago` — eje de pago: `PAGO_PENDIENTE`, `RETENER`, `CREDITO`, `REEMBOLSADO`, `PAGADO`, `CANCELADO` (terminal). `LIBERAR` existió hasta la migración `quitar_liberar`, que pasó sus pedidos a `PAGO_PENDIENTE`.
- `BitacoraPedido` — un renglón por cambio de estado en cualquiera de los dos ejes (`eje`, `estadoAnterior`, `estadoNuevo`, `nota`, actor congelado con su nombre). Solo se escribe; `src/pedidos/bitacora.ts` es el único sitio que la escribe.

**Rutas** — la jornada del repartidor, el camión y el dinero que trae de vuelta. Cuatro columnas de `Pedido` cuelgan de aquí: `repartidorId` (se lo queda el primero que lo recolecta), `liquidado`/`liquidadoEn` y `corteId`.
- `SesionEntrega` — de «Inicio de entregas» a la liquidación. **Un repartidor solo puede tener una sin liquidar**, garantizado por un índice único parcial (`repartidorId WHERE corteId IS NULL`) escrito en la migración, porque Prisma no sabe expresarlo.
- `CargaRepartidor` — qué va en el camión: cuánto subió, cuánto aceptó el cliente y cuánto regresa, con su precio congelado y el re-cotizado de las entregas parciales. Está aparte de `PedidoItem` porque un mismo renglón puede salir a la calle varias veces; ahí se lee el historial de intentos. Otro índice parcial (`pedidoItemId WHERE cerradoEn IS NULL`) impide que un item vaya en dos camiones a la vez, y un `CHECK` que salga del camión más de lo que subió.
- `EntregaPedido` — la evidencia que cierra una entrega a domicilio: foto, firma y coordenadas. Las imágenes van al almacén `imagenes` (carpeta `entregas`) y aquí solo se apunta, para que la pantalla de Rutas no las arrastre en cada consulta.
- `Corte` — el cierre de caja: calculado, declarado y contado. Dos `CHECK` lo cuidan: los tres datos de la recepción van juntos o no van, y **quien recibe no puede ser quien cerró**.
- `CorteAbono` — lo que el repartidor entrega después si al recibir faltó dinero. En filas aparte para no reescribir los montos del corte.
- Enums: `MotivoDevolucion` (catálogo cerrado: de ahí salen los reportes), `EstadoCorte` (CERRADO/RECIBIDO).

**Cupones**
- `TipoCuponCicloVida` — los 5 tipos automáticos, con `code` como clave natural.
- `Campania` — campañas manuales con audiencia, `segmentRules` (JSON), `categorias[]`, límites de uso.
- `CuponEmitido` — cada cupón entregado, con los importes **congelados** de su plantilla. Cuelga de `clienteId` **o** de `prospectoId`. `usedPedidoId` es `@unique`: un cupón por pedido, garantizado por la base.
- `FuenteAdquisicion` — fuentes de tráfico con su código corto.
- Enums: `TipoDescuento`, `EstadoCupon` (ACTIVE/USED/EXPIRED/CANCELLED), `OrigenCupon` (LIFECYCLE/CAMPAIGN), `TipoAudiencia`, `TipoFuente`.

**Configuración y contenido**
- `ConfiguracionNegocio` — fila única (`id = 1`): horario, envío, recargo, parámetros de cashback, datos bancarios y `controlInventario`, el interruptor que decide si un pedido descuenta existencias.
- `NivelFidelidad` — escalera de niveles con `umbralGasto`, `orden` y `porcentaje` de cashback. `Cliente.pctExtra` es el bono manual que se le suma, editado a mano en la base.
- `MovimientoCashback` — cada acreditación, para poder recalcular.
- `NoticiaDestacada`, `Aviso` — contenido del panel de Destacados.
- `LecturaDestacados` — última lectura por cliente; de ahí sale el contador de no leídos.

### [migrations/](prisma/migrations/)

Nueve migraciones, en orden cronológico:

| Migración | Qué introduce |
| --- | --- |
| `20260904000000_init` | Esquema base: usuarios, clientes, catálogo. |
| `20260904000100_catalogo_recetario_pedidos_cupones_config` | El grueso del modelo: recetario, pedidos, motor de cupones y configuración. |
| `20260904000200_folio_pedidos` | La secuencia `pedidos_folio_seq` de Postgres que sirve los folios `ORD000001`. |
| `20260908204416_cliente_sucursal` | Campo `sucursal` en cliente (se usa para segmentar campañas). |
| `20260908232426_prospectos` | La tabla `prospectos` y la columna `prospectoId` en cupones. |
| `20260908233158_prospecto_perfil` | Los campos de perfil y dirección del prospecto. |
| `20260909000000_producto_sin_emoji` | Retira el emoji del producto. |
| `20260909001000_catalogo_categorias` | Saca la categoría a su propia tabla y convierte `Producto.categoria` en relación. |
| `20260909120000_inventario_movimientos` | Bodega: los dos saldos en `productos`, la tabla `movimientos_inventario`, el interruptor `controlInventario` y un `CHECK` que impide un saldo negativo. Todo aditivo y con valores por defecto, así que los productos que ya existían arrancan en cero. |

`migration_lock.toml` fija el proveedor en postgresql.

### [seed.ts](prisma/seed.ts)

Datos del prototipo. **Idempotente y no destructivo:** lo que tiene clave natural (tipos de cupón, configuración, niveles, fuentes) se escribe con `upsert`; el catálogo y el contenido solo se llenan si la tabla está vacía.

Contiene 13 productos, 8 recetas (6 oficiales + 2 de comunidad), los 5 tipos de ciclo de vida, las fuentes, noticias, avisos y los tres niveles. `seedAdministrador()` **falla a propósito en producción si no hay `ADMIN_PASSWORD`**.

---

## `src/` — arranque

### [main.ts](src/main.ts)

El bootstrap. Cuatro cosas:

1. **CORS** desde `CORS_ORIGIN` (lista separada por comas). Sin la variable, solo Vite en `localhost:5173`.
2. **`ValidationPipe` global** con `whitelist`, `forbidNonWhitelisted` y `transform`: un campo de más en el body es un 400, y los DTOs llegan ya convertidos a sus tipos.
3. **Swagger** en `/docs`, con `persistAuthorization` para no volver a pegar el token en cada recarga.
4. **Avisos de seguridad** en el log si quedó encendido `AUTH_DEMO_LOGIN`, `AUTH_OTP_BYPASS` o `NOTIFICATIONS_ALLOW_CONSOLE`.

### [app.module.ts](src/app.module.ts)

Registra los 15 módulos y —lo importante— los dos guards globales:

```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard }   // todo cerrado por defecto
{ provide: APP_GUARD, useClass: RolesGuard }     // + matriz de permisos
```

`ConfigModule` es global, y `ScheduleModule` habilita los `@Cron`.

---

## `src/auth/` — autenticación y permisos

| Archivo | Qué contiene |
| --- | --- |
| [auth.module.ts](src/auth/auth.module.ts) | `@Global`. Configura `JwtModule` leyendo `JWT_SECRET` (**la app no arranca sin ella**) y `JWT_EXPIRES_IN` (por defecto `7d`). |
| [auth.controller.ts](src/auth/auth.controller.ts) | `GET /auth/modo` (qué modos de acceso ofrece la API), `POST /auth/demo/entrar`, `POST /auth/staff/login`, `POST /auth/cliente/solicitar-codigo`, `POST /auth/cliente/verificar-codigo`, `GET /auth/yo`. Todas públicas salvo la última. |
| [auth.service.ts](src/auth/auth.service.ts) | El corazón. Login de staff con argon2 (verifica siempre contra un hash señuelo aunque el email no exista, para no filtrar por tiempo de respuesta qué correos están dados de alta). Login de cliente en dos pasos con OTP de 6 dígitos, 5 minutos de vigencia y 5 intentos. **`verificarCodigo` busca el teléfono solo en `clientes`**; a quien no esté se le pide el nombre y se hace `upsert` en `prospectos`. Al entrar dispara la evaluación de cupones. Exporta `otpSinEnvio()` y `demoLoginActivo()`. |
| [jwt-payload.ts](src/auth/jwt-payload.ts) | Forma del token: `sub`, `rol`, `nombre` y `tipo` (CLIENTE/PROSPECTO). Define `ROL_CLIENTE` y `RolToken` (los 4 roles de staff + cliente). |
| [permisos.ts](src/auth/permisos.ts) | **La matriz.** Las 9 secciones del panel y qué rol entra a cada una, portada literal de la tabla del Word 2.4. Cambiar aquí cambia el acceso en toda la API. |
| [jwt-auth.guard.ts](src/auth/jwt-auth.guard.ts) | Extrae el `Bearer`, lo verifica y lo deja en `request.user`. Deja pasar lo marcado con `@Public()`. |
| [roles.guard.ts](src/auth/roles.guard.ts) | Lee `@RequiereSeccion()`, `@Roles()` o `@SoloPersonal()` del handler o la clase y consulta la matriz. Sin ninguno de los tres, basta con estar autenticado. |
| [public.decorator.ts](src/auth/public.decorator.ts) | `@Public()` — ruta accesible sin token. |
| [seccion.decorator.ts](src/auth/seccion.decorator.ts) | `@RequiereSeccion('productos')` — ata la ruta a una sección del panel. Acepta varias (`@RequiereSeccion('operaciones', 'rutas')`): basta con tener una. |
| [solo-personal.decorator.ts](src/auth/solo-personal.decorator.ts) | `@SoloPersonal()` — cierra la ruta o el controlador a los tokens de cliente aunque la matriz le dé la sección. Existe por `mis-pedidos`, que es a la vez el historial del cliente y el listado de toda la plataforma. |
| [roles.decorator.ts](src/auth/roles.decorator.ts) | `@Roles(...)` — restricción a mano, para rutas que no corresponden a ninguna sección. |
| [usuario-actual.decorator.ts](src/auth/usuario-actual.decorator.ts) | `@UsuarioActual()` — inyecta el payload del token en el handler. |
| [identidad.ts](src/auth/identidad.ts) | `resolverIdentidad()` y `esProspectoEnBase()`: buscan un id en las dos tablas. **Manda la base, no el `tipo` del token**, porque al convertirse un prospecto conserva su id y el token viejo sigue valiendo con el tipo obsoleto. |
| [dto/staff-login.dto.ts](src/auth/dto/staff-login.dto.ts) | Email válido + contraseña de 8 caracteres mínimo. |
| [dto/cliente-login.dto.ts](src/auth/dto/cliente-login.dto.ts) | Teléfono con regex, código de 6 dígitos, `nombre` opcional (obligatorio solo en el alta) y `fuenteCodigo` del enlace `/r/CODIGO`. |
| [dto/demo-login.dto.ts](src/auth/dto/demo-login.dto.ts) | Valida que el rol pedido sea uno de los cinco. |

---

## `src/prisma/` — cliente de base de datos

| Archivo | Qué contiene |
| --- | --- |
| [prisma.module.ts](src/prisma/prisma.module.ts) | `@Global`: cualquier servicio inyecta `PrismaService` sin importar nada. |
| [prisma.service.ts](src/prisma/prisma.service.ts) | Extiende `PrismaClient` y engancha `$connect`/`$disconnect` al ciclo de vida de Nest. No hay capa de repositorios: los servicios hablan con Prisma directo. |

---

## `src/notifications/` — envío a WhatsApp

| Archivo | Qué contiene |
| --- | --- |
| [notification-sender.ts](src/notifications/notification-sender.ts) | La interfaz `NotificationSender` (`enviarCodigoOtp`, `enviarMensajeCupon`) y su token de inyección. Es el punto de enchufe para WhatsApp Business API / n8n. |
| [console-notification-sender.ts](src/notifications/console-notification-sender.ts) | Implementación de desarrollo: escribe en el log en vez de enviar. |
| [notifications.module.ts](src/notifications/notifications.module.ts) | `@Global`. La factory **se niega a registrar la implementación de consola con `NODE_ENV=production`** (dejaría los OTP en los logs), salvo que `NOTIFICATIONS_ALLOW_CONSOLE=true` acepte el riesgo a propósito. |

---

## `src/admin/` — menú del panel

| Archivo | Qué contiene |
| --- | --- |
| [admin-menu.controller.ts](src/admin/admin-menu.controller.ts) | `GET /admin/menu`: devuelve las tarjetas (icono, título, descripción) que le tocan al rol del token. El frontend no decide qué mostrar, lo pregunta. |
| [admin.module.ts](src/admin/admin.module.ts) | Registra el único que queda. Aquí vivían los 501 de las secciones sin construir; ya no hay ninguna: Operaciones, Finanzas y Rutas tienen su módulo. |

---

## `src/catalogo/` — productos y categorías

| Archivo | Qué contiene |
| --- | --- |
| [catalogo.module.ts](src/catalogo/catalogo.module.ts) | **El orden de `controllers` importa:** importación va antes que productos para que `GET /admin/productos/plantilla` no la capture la ruta `:id`. |
| [catalogo.controller.ts](src/catalogo/catalogo.controller.ts) | Tienda: `GET /productos` (agrupado por categoría), `GET /categorias`, `GET /productos/:id`, `POST /productos/:id/programar`. |
| [admin-productos.controller.ts](src/catalogo/admin-productos.controller.ts) | CRUD bajo `@RequiereSeccion('productos')`, más el interruptor `PATCH :id/agotado`. |
| [admin-categorias.controller.ts](src/catalogo/admin-categorias.controller.ts) | `GET /admin/categorias`, solo lectura: las categorías se crean solas desde las altas y las importaciones. |
| [admin-importacion.controller.ts](src/catalogo/admin-importacion.controller.ts) | `POST /admin/productos/importar` (.xlsx, máx. 5 MB, procesado en memoria) y `GET /admin/productos/plantilla`, que genera el Excel de ejemplo al vuelo. |
| [catalogo.service.ts](src/catalogo/catalogo.service.ts) | Listado agrupado con filtros, CRUD y `programar()`. Los precios son `Decimal` en la base y `number` al serializar. **Un producto que ya aparece en pedidos no se puede borrar** (409): eso reescribiría el historial; para retirarlo está el agotado. Las listas de volumen entran y salen como `escalones: [{ piso, precio }]` y se validan contra el precio de venta que va a quedar. |
| [precios.ts](src/catalogo/precios.ts) | Precio escalonado, funciones **puras** (probadas en `precios.spec.ts`). `precioVenta` es la lista 1; `piso2`/`precio2` y `piso3`/`precio3` son las listas 2 y 3, sin tope superior: el techo de una es el piso de la siguiente. `precioUnitario()`, `precioListaAnterior()` (tachado), `ahorro()` (contra el precio de venta) y `upsell()` (regla del 80 %: `faltan × 5 ≤ piso`). `validarEscalones()` repite en palabras los CHECK de la migración. |
| [categorias.service.ts](src/catalogo/categorias.service.ts) | `resolver(nombre)` da de alta la categoría si es nueva y la reutiliza si ya existe, comparando sin distinguir mayúsculas y con espacios colapsados. Maneja el choque `P2002` de dos altas simultáneas. Una categoría **no se borra al quedarse sin productos**: las campañas restringen por categoría y no pueden quedar apuntando al aire. |
| [importacion.service.ts](src/catalogo/importacion.service.ts) | Lee el .xlsx con exceljs, normaliza los encabezados (sin acentos ni mayúsculas), convierte `"$1,234.50"` a número. **Una fila inválida no aborta la importación:** se reporta y sigue. Mismo nombre + misma categoría = actualiza en vez de duplicar. Devuelve un resumen con creados, actualizados, errores y categorías nuevas. Columnas opcionales `Piso 2`, `Precio 2`, `Piso 3`, `Precio 3` y `Aplica cashback`: si el archivo no las trae, no toca lo que ya tuviera el producto. |
| [dto/producto.dto.ts](src/catalogo/dto/producto.dto.ts) | `CrearProductoDto`, `ActualizarProductoDto`, `MarcarAgotadoDto`, `BuscarProductosDto`. |

---

## `src/inventario/` — bodega y bitácora

`@Global`, porque la transacción del pedido descuenta lo vendido.

La regla de la que cuelga todo: **aquí nadie escribe un saldo, solo lo suma o lo
resta.** Un `SET` pisaría lo que otro acaba de mover y dejaría la bitácora
mintiendo. Por eso no existe un «ajustar inventario a N»: para corregir se
registra el movimiento que falta, con motivo `AJUSTE`, y queda escrito.

| Archivo | Qué contiene |
| --- | --- |
| [inventario.module.ts](src/inventario/inventario.module.ts) | Un controlador, un servicio, exportado para Pedidos. |
| [admin-inventario.controller.ts](src/inventario/admin-inventario.controller.ts) | `GET /admin/inventario` (saldos), `GET /admin/inventario/movimientos` (bitácora) y `POST /admin/inventario/movimientos` (registrar un lote). Cuelga de `@RequiereSeccion('productos')`: quien da de alta un producto es quien mueve su mercancía. |
| [inventario.service.ts](src/inventario/inventario.service.ts) | `saldos()` incluye los agotados a propósito — un producto retirado de la Tienda sigue teniendo mercancía que hay que poder sacar. `registrarLote()` aplica los N renglones en **una sola transacción**: si al tercero no le alcanza, los dos primeros tampoco se guardan. Rechaza el motivo `VENTA` (esa salida la escribe el pedido, y capturarla a mano descontaría dos veces) y los productos repetidos en un lote. `registrarVenta()` es lo que llama el checkout y `devolverPedido()` lo que llama Finanzas al cancelar: **no reconstruye la devolución desde las líneas del pedido sino desde sus movimientos de `VENTA`**, porque un pedido hecho con el control apagado no descontó nada y sumarle sus líneas inflaría el saldo. `aplicar()` es el único sitio donde cambian los saldos: **la condición de saldo viaja dentro del `WHERE` del propio `UPDATE`**, no en un `SELECT` previo, así que Postgres serializa y dos salidas simultáneas no pueden dejar negativo; si no actualizó ninguna fila (`P2025`) es que no alcanzaba. El «antes» de la bitácora se deduce del delta en vez de consultarse, porque un `SELECT` previo podría leer un saldo que otra transacción ya cambió. |
| [dto/movimiento.dto.ts](src/inventario/dto/movimiento.dto.ts) | `RegistrarMovimientosDto` (tipo, afecta, motivo, empleado, líneas) y `BuscarMovimientosDto` (filtros por producto y motivo). |

---

## `src/clientes/` — perfil, clientes y prospectos

| Archivo | Qué contiene |
| --- | --- |
| [clientes.module.ts](src/clientes/clientes.module.ts) | Los dos controladores y el servicio. |
| [clientes.controller.ts](src/clientes/clientes.controller.ts) | `GET /perfil` y `PATCH /perfil`. No corresponde a ninguna sección del panel, así que comprueba el rol a mano. |
| [admin-clientes.controller.ts](src/clientes/admin-clientes.controller.ts) | `GET /admin/clientes` y `GET /admin/clientes/prospectos`, bajo `@RequiereSeccion('clientes')` (ADMINISTRADOR y FINANZAS). |
| [clientes.service.ts](src/clientes/clientes.service.ts) | El perfil funciona igual para cliente y prospecto: se busca primero en `clientes`, luego en `prospectos`, y al prospecto se le pintan los contadores de compra en cero. Listados de admin con buscador, orden (`ultimoPedido` con `nulls: 'last'`) y paginación. |
| [dto/perfil.dto.ts](src/clientes/dto/perfil.dto.ts) | `ActualizarPerfilDto` — **`telefono` no está a propósito**: es la identidad de login, y con `forbidNonWhitelisted` mandarlo da 400. Más las interfaces de respuesta (`PerfilDto`, `ClienteAdminDto`, `ProspectoAdminDto` y sus versiones paginadas) y `BuscarClientesDto`. |

---

## `src/pedidos/` — carrito y checkout

| Archivo | Qué contiene |
| --- | --- |
| [pedidos.module.ts](src/pedidos/pedidos.module.ts) | Cinco controladores, cuatro servicios. |
| [carrito.controller.ts](src/pedidos/carrito.controller.ts) | `POST /carrito/previsualizar`, `POST /carrito/subtotal` (público: la barra de la Tienda, con cashback al % del nivel de entrada) y `POST /carrito/validar-cupon`. **Los dos responden 200 aunque el carrito no se pueda pedir o el cupón no valga**: el motivo viaja en el cuerpo, porque un cupón rechazado no es un error de la petición sino información que el cliente necesita ver. |
| [pedidos.controller.ts](src/pedidos/pedidos.controller.ts) | `POST /pedidos` (confirmar) y `GET /pedidos/mios`. |
| [admin-pedidos.controller.ts](src/pedidos/admin-pedidos.controller.ts) | `GET /admin/pedidos` — historial completo, tope de 500. `GET /admin/pedidos/:id/bitacora` (Operaciones, Rutas, Finanzas o admin). `PATCH /admin/pedidos/:id/pago` — Finanzas lo pasa a `PAGADO`. **El cliente también tiene la sección `mis-pedidos`**, así que la clase entera lleva `@SoloPersonal()`. |
| [operaciones.controller.ts](src/pedidos/operaciones.controller.ts) | `GET /admin/operaciones/pedidos` — la pantalla de surtido, con sus cuatro pestañas (`activos`, `en-ruta`, `entregados`, `cancelados`) y el contador de cada una. `PATCH /admin/operaciones/pedidos/:id/estado` — el siguiente paso físico; los candados de Finanzas responden 409 con su `code`. |
| [finanzas.controller.ts](src/pedidos/finanzas.controller.ts) | `GET /admin/finanzas/pedidos` con sus cuatro pestañas (`por-decidir`, `credito`, `pagados`, `cancelados`) y `PATCH /admin/finanzas/pedidos/:id/pago`. **El único sitio por el que se escribe `estadoPago`**, para que las reglas y los efectos de cada estatus no se repitan en dos caminos. |
| [flujo.ts](src/pedidos/flujo.ts) | Reglas puras del eje físico: `TRANSICIONES` (de, a, sección, modo de entrega, si exige pago liberado), `esLiberado()` (todo menos `RETENER`), `pagoCubierto()` (lo que exige «Entregado»), `evaluarAvance()` —devuelve la transición o el bloqueo con su `code`: `TRANSICION_INVALIDA`, `SOLO_A_DOMICILIO`, `SOLO_EN_TIENDA`, `PEDIDO_CANCELADO`, `PAGO_RETENIDO`, `PAGO_NO_LIBERADO`, `PAGO_NO_CUBIERTO`— y `siguientePaso()`. Probadas en `flujo.spec.ts`. |
| [flujo-pedidos.service.ts](src/pedidos/flujo-pedidos.service.ts) | Aplica un paso: bloquea la fila (`FOR UPDATE`, para que Finanzas no retenga el pago a media transición), valida con `flujo.ts`, comprueba la sección del paso y escribe estado + bitácora en la misma transacción. Los pasos de Rutas no entran por `avanzarEnOperaciones()`: `RutasService` usa `bloquearFila()`/`exigirAvance()`/`aplicar()` y añade sus propios efectos. |
| [flujo-pago.ts](src/pedidos/flujo-pago.ts) | Reglas puras del eje del dinero. Aquí **no hay secuencia**: se va de cualquier estatus a cualquier otro. Lo único que frena lo dicen `evaluarCambioPago()` y sus tres códigos: `PAGO_TERMINAL` (de cancelado no se sale), `MERCANCIA_FUERA` (ya salió de bodega) y `MISMO_ESTADO`. `botonesDePago()` devuelve los siete con su candado resuelto. Probadas en `flujo-pago.spec.ts`. |
| [finanzas.service.ts](src/pedidos/finanzas.service.ts) | Aplica el cambio con la fila bloqueada y encadena lo que cada estatus arrastra: `PAGADO` acredita el cashback congelado; `CANCELADO` **deshace el pedido** (`deshacer()`) — la mercancía que de verdad salió vuelve a bodega, el saldo de billetera gastado se devuelve, el cashback acreditado se retira hasta donde alcance el saldo y el pedido deja de contar como gasto. El cupón **no** se devuelve: sigue en USED. |
| [bitacora.ts](src/pedidos/bitacora.ts) | `registrarEnBitacora()`, único sitio que escribe `bitacora_pedidos`, y `actorDe()` para firmar con el usuario del token. |
| [carrito.service.ts](src/pedidos/carrito.service.ts) | Toda la aritmética del dinero. `resolver()` reconstruye el carrito contra la base (**el cliente manda `productoId` y `cantidad`, nunca importes**) y lanza si hay agotados; `resolverTolerante()` hace lo mismo sin lanzar, para previsualizar. `validarCupon()` aplica las validaciones en el orden del prototipo, con la base recortada a las categorías del cupón cuando las tiene. `calcularCarrito()` es el **único sitio** donde se calculan envío, recargo, total y cashback: lo llaman tanto la previsualización como el checkout, así que no pueden divergir. Cada línea se valora a precio escalonado (`precios.ts`) y lleva su tachado, ahorro y upsell; la base del cashback son solo las líneas con `aplicaCashback`. `metas()` dice lo que falta para el envío gratis (`>=`) y para el cashback (`>` estricto, aviso desde el 80 % del mínimo). |
| [pedidos.service.ts](src/pedidos/pedidos.service.ts) | `crear()` — los 10 pasos del checkout, **todos dentro de una transacción**: resolver el carrito, calcular, bloquear la fila del cupón con `SELECT ... FOR UPDATE`, convertir al prospecto, crear el pedido, marcar el cupón USED, cancelar el WELCOME sobrante, **descontar de bodega si `controlInventario` está encendido**, actualizar contadores, emitir SECOND_PURCHASE. `convertir()` es el único sitio donde nace un cliente nuevo: **conserva el id del prospecto**, mueve sus cupones y borra su fila. `siguienteFolio()` usa la secuencia de Postgres. |
| [dto/carrito.dto.ts](src/pedidos/dto/carrito.dto.ts) | `LineaCarritoDto` (solo id y cantidad), `ValidarCuponDto`, `PrevisualizarCarritoDto`, `CrearPedidoDto` (con `DireccionEntregaDto`, obligatoria a domicilio y copiada en el pedido), `GuardarCarritoDto` (lineas + borrador de entrega). |

---

## `src/rutas/` — la jornada del repartidor

Mueve pedidos, pero vive aparte de `pedidos/`: lo suyo es la jornada, el camión
y el corte. Toma prestado de `PedidosModule` lo que ya sabe mover el eje físico
y leer un pedido.

| Archivo | Qué contiene |
| --- | --- |
| [rutas.controller.ts](src/rutas/rutas.controller.ts) | `GET /admin/rutas` — el tablero: la jornada **y** los pedidos de la pestaña en una sola respuesta, porque todo lo que el repartidor puede pulsar depende de su jornada y son dos datos de la misma pantalla de teléfono. Pestañas: `disponibles` (lo que espera en bodega, de todos), `en-camion` y `entregados` (lo suyo, sin liquidar). Más `POST jornada`, `POST jornada/finalizar`, `POST pedidos/:id/recolectar`, `POST pedidos/:id/en-ruta`, `POST pedidos/:id/entregar`, `POST pedidos/:id/no-entregar`, `GET corte` (lo que dice el sistema que trae, sin cambiar nada), `POST corte` y `PATCH cortes/:id`. |
| [rutas.service.ts](src/rutas/rutas.service.ts) | `abrirJornada()` **reabre la que estaba finalizada** en lugar de crear otra: mientras no haya corte es el mismo día y el mismo camión, y dos jornadas partirían en dos lo que debe liquidarse junto; abrir teniendo una viva es 409 `JORNADA_ABIERTA`, y el índice parcial es quien de verdad lo impide (el P2002 se traduce al mismo código). `recolectar()` hace tres cosas en una transacción además del paso: el pedido **se queda con su repartidor**, cada renglón abre su fila de `CargaRepartidor` con el precio congelado, y el paso con su bitácora por el camino de siempre. `entregar()` cierra el pedido con lo que el cliente aceptó; `noEntregar()` anota el intento **sin mover el estado**. `exigirPropio()` es un candado de dónde está la mercancía, no de permisos: tampoco el administrador marca "En ruta" un camión en el que no va. |
| | `conCarga()` le pega a cada pedido sus renglones de camión: el `PedidoDto` no expone el id de sus líneas, así que sin esto la pantalla no tendría qué mandar al entregar. `emparejar()` exige el recuento **completo** —todos los renglones y ninguno de más—, porque dar por entregado en silencio lo que no viene convertiría un olvido de la interfaz en mercancía cobrada. `recotizar()` devuelve el precio del volumen que de verdad se lleva: quien pide 10 al precio de 10 y acepta 6 no compró 10. Se usan las listas **vigentes** del producto porque el pedido guarda el unitario que se cobró, no las listas con que se calculó. |
| [dto/nota-ruta.dto.ts](src/rutas/dto/nota-ruta.dto.ts) | Los botones de Rutas no eligen destino —cada uno es un solo paso—, así que lo único que viaja es la aclaración para la bitácora. |
| [dto/entregar-pedido.dto.ts](src/rutas/dto/entregar-pedido.dto.ts) | `EntregarPedidoDto` (lo **aceptado** de cada renglón, no lo devuelto: es lo que se cuenta delante del cliente; más foto, firma y coordenadas, todas opcionales) y `NoEntregadoDto` (un motivo para el pedido entero, obligatorio). |
| [dinero-del-corte.ts](src/rutas/dinero-del-corte.ts) | Reglas puras de cuánto efectivo trae el repartidor. `traeEfectivo()` filtra lo que pasa por sus manos —solo efectivo sin cobrar: una transferencia no la trae él y `CREDITO` es Finanzas autorizando entregar sin cobrar—, y `efectivoDelPedido()` parte de lo que el pedido iba a cobrar y descuenta lo que el cliente no aceptó, a los precios que correspondan. Envío y descuento no se tocan (el viaje se hizo, el cupón se usó) y el resultado nunca baja de cero. Probadas en `dinero-del-corte.spec.ts`. |
| [cortes.service.ts](src/rutas/cortes.service.ts) | `cerrar()` — el cierre del día en una transacción: nace el corte con lo calculado y lo declarado **uno al lado del otro** (para que Finanzas vea la diferencia en vez de descubrirla contando), los pedidos entregados quedan liquidados, **se descarga el camión** y la jornada muere atada a su corte. `descargarCamion()` escribe lo devuelto en cada renglón, lo cierra, lo reingresa a bodega y devuelve a la cola los pedidos que no se entregaron: **el único retroceso del eje físico**, que no pasa por `TRANSICIONES` porque no es un paso adelante sino la constatación de que la mercancía volvió. `recibir()` comprueba que quien cuenta no sea quien cerró; `abonar()` deja lo que se entregue después en su propia fila, sin reescribir los montos del día. |
| [dto/corte.dto.ts](src/rutas/dto/corte.dto.ts) | `CerrarCorteDto` (lo declarado), `RecibirCorteDto` (lo contado) y `RegistrarAbonoDto`. |
| [finanzas-cortes.controller.ts](src/rutas/finanzas-cortes.controller.ts) | `GET /admin/finanzas/cortes` (`por-recibir`, `recibidos`), `GET :id`, `POST :id/recibir` y `POST :id/abonos`. Vive en Rutas aunque lo use Finanzas, igual que `pedidos/finanzas.controller.ts`: el dominio manda sobre la audiencia. |
| [evidencia.controller.ts](src/rutas/evidencia.controller.ts) | `GET /admin/pedidos/:id/evidencia` — la prueba de entrega (foto, coordenadas, quién y cuándo), o `null` si no se ha entregado. Solo para personal de Operaciones, Rutas y Finanzas (`@SoloPersonal`). Va aparte de la bitácora porque no es un cambio de estado sino la evidencia del último. |
| [rutas.module.ts](src/rutas/rutas.module.ts) | Importa `PedidosModule`, `InventarioModule` y `ConfiguracionModule`: del corte cuelga la vuelta a bodega, y con `controlInventario` apagado no se toca el saldo. |

**El total del pedido no se reescribe nunca**, ni siquiera en una entrega
parcial: es el recibo de lo que se compró. Lo cobrado de verdad vive en
`CargaRepartidor.precioEntregado` y lo suma el corte.

**La mercancía baja del camión en un solo sitio: el corte.** Entregar solo
apunta lo que el cliente no aceptó; hasta que se liquida, esas piezas siguen
físicamente arriba y por eso ni vuelven a bodega ni pueden salir en otro
camión. Esto es lo que hace que el conteo de la jornada (`cantidadCargada -
cantidadEntregada`) diga siempre lo que hay en el vehículo.

Códigos de error que interpreta la interfaz: `SIN_JORNADA`, `JORNADA_ABIERTA`,
`JORNADA_FINALIZADA`, `PEDIDO_DE_OTRO`, `ITEM_EN_CAMION`, `SIN_CARGA`,
`RENGLON_DESCONOCIDO`, `RENGLONES_INCOMPLETOS`, `CANTIDAD_DE_MAS`,
`FALTA_MOTIVO`, `MOTIVO_DE_MAS`, `NADA_ENTREGADO`, `NO_ESTA_EN_RUTA`,
`IMAGEN_NO_ENCONTRADA`, `CORTE_DE_OTRO`, `CORTE_RECIBIDO`,
`CORTE_SIN_RECIBIR`, `RECIBE_EL_MISMO`, más los del flujo
(`PAGO_NO_LIBERADO`, `TRANSICION_INVALIDA`…).

---

## `src/cupones/` — motor de cupones

El módulo más grande. Es `@Global` porque el login y el checkout disparan emisiones.

| Archivo | Qué contiene |
| --- | --- |
| [cupones.module.ts](src/cupones/cupones.module.ts) | 4 controladores, 6 servicios. |
| [cupones.service.ts](src/cupones/cupones.service.ts) | La emisión. `emitir()` **congela** los importes de la plantilla en la fila del cupón (editar el tipo después no toca lo ya entregado). `generarCodigoUnico()` produce `RPD` + 4 caracteres de un alfabeto sin I, O, 0 ni 1, que se confunden al dictar por teléfono. Los cinco disparadores: `maybeIssueWelcome`, `maybeIssueWelcomeProspecto`, `maybeIssueSecondPurchase`, `maybeIssueInactivity`, `maybeIssueBirthday`. El de cumpleaños mide contra el aniversario del año anterior, este y el siguiente, y usa una ventana de 300 días para el «una vez al año» (comparar años naturales daría dos cupones en el cambio de año). |
| [ciclo-vida.service.ts](src/cupones/ciclo-vida.service.ts) | CRUD de los 5 tipos automáticos. Los contadores `generados`/`utilizados` salen de un `groupBy` en vivo, no de columnas. Desactivar un tipo detiene nuevas emisiones pero no invalida las ya entregadas. |
| [campanias.service.ts](src/cupones/campanias.service.ts) | CRUD de campañas y `emitirCampaniasElegibles()`, que se llama al iniciar sesión y al abrir Cupones (así una campaña creada hoy alcanza a clientes de ayer). `clienteCalifica()` traduce cada tipo de audiencia a un sí/no. Al renombrar una campaña **arrastra el `sourceCode` de los cupones ya emitidos**, o quedarían huérfanos en las métricas. |
| [segmentacion.ts](src/cupones/segmentacion.ts) | Funciones **puras**, sin Prisma ni Nest: la regla más delicada del motor, aislada para poder probarla. 10 atributos, 6 operadores. Las reglas se combinan siempre con Y, y **un segmento sin reglas no califica a nadie** (una campaña a medio configurar no puede emitirse a todo el mundo). |
| [fuentes.service.ts](src/cupones/fuentes.service.ts) | Fuentes de adquisición y su enlace `<APP_PUBLIC_URL>/r/CODIGO`. **El código no se puede cambiar** (ya está impreso en carteles y QR) y una fuente con clientes atribuidos no se borra, se desactiva. `codigoValido()` ignora los códigos inventados en vez de guardarlos. |
| [metricas.service.ts](src/cupones/metricas.service.ts) | Resumen y desglose por tipo, **todo calculado en vivo** desde los cupones realmente emitidos. Sin contadores almacenados que se puedan desincronizar. |
| [expiracion.service.ts](src/cupones/expiracion.service.ts) | `@Cron` diario a las 3:00 que marca EXPIRED los ACTIVE vencidos. Necesario porque las métricas cuentan por estado. Es la red de seguridad para los cupones que nadie intenta usar; el checkout también los marca cuando se topa con uno. |
| [cupones.controller.ts](src/cupones/cupones.controller.ts) | `GET /cupones` — «Mis Cupones». Reevalúa las campañas antes de responder. |
| [admin-ciclo-vida.controller.ts](src/cupones/admin-ciclo-vida.controller.ts) | Listar, editar, activar/desactivar y emitir de prueba los 5 tipos. |
| [admin-campanias.controller.ts](src/cupones/admin-campanias.controller.ts) | CRUD de campañas + emitir de prueba. |
| [admin-fuentes.controller.ts](src/cupones/admin-fuentes.controller.ts) | CRUD de fuentes, `GET /admin/cupones/metricas` y `POST /admin/cupones/expirar-vencidos` (para verificar el job sin esperar al día siguiente). |
| [dto/](src/cupones/dto/) | `campania.dto.ts` (incluye `ReglaSegmentoDto`), `ciclo-vida.dto.ts` (sin `code`: no es editable) y `fuente.dto.ts` (código de 2–20 alfanuméricos, va en una URL). |

---

## `src/cashback/` — saldo y niveles

`@Global`, porque la transacción del pedido acredita cashback.

| Archivo | Qué contiene |
| --- | --- |
| [cashback.module.ts](src/cashback/cashback.module.ts) | Dos controladores, un servicio. |
| [cashback.controller.ts](src/cashback/cashback.controller.ts) | `GET /perfil/cashback` (saldo, nivel, progreso) y `GET /perfil/cashback/movimientos`. |
| [admin-niveles.controller.ts](src/cashback/admin-niveles.controller.ts) | CRUD de niveles bajo `@RequiereSeccion('configuracion')`. Existe porque los umbrales no están en el Word: mejor configurables que escritos a mano. |
| [cashback.service.ts](src/cashback/cashback.service.ts) | `calcular()` — `floor(base × % / 100)`, solo si la base **supera** el mínimo; la base es lo que suman los productos con `aplicaCashback`, no el subtotal. `porcentajePara()` da el % del nivel (calculado en vivo con los umbrales vigentes; sin nivel, el de entrada) más `pctExtra`. `aBilletera()` aplica `multiplicadorCashback` (×2): es lo que se acredita, mientras la Tienda y el carrito enseñan la base. Cada acreditación queda en `MovimientoCashback` para recalcular. `recalcularNivel()` corre dentro de la transacción del pedido; `acreditarPedido()` pasa a la billetera el cashback congelado en el pedido, dentro de la transacción que lo deja `PAGADO`, y es idempotente gracias a `cashbackAcreditadoEn`. Al borrar un nivel, sus clientes quedan sin nivel hasta el siguiente pedido; nadie pierde saldo. |
| [dto/nivel.dto.ts](src/cashback/dto/nivel.dto.ts) | Nombre, `umbralGasto`, `orden` y `porcentaje`. |

---

## `src/recetario/` — recetas

| Archivo | Qué contiene |
| --- | --- |
| [recetario.module.ts](src/recetario/recetario.module.ts) | **El orden importa:** las rutas concretas (`/recetario/...`, `/recetas/:id/guardar`) van antes que `RecetarioController`, cuyo `GET :id` capturaría cualquier segmento. |
| [recetario.controller.ts](src/recetario/recetario.controller.ts) | `GET /recetas` (por pestaña), `POST /recetas`, `GET /recetas/:id`, `PATCH /recetas/:id`, `PATCH /recetas/:id/compartir`. **El detalle es el único punto donde se comprueba el bloqueo por inactividad**: mirar la lista nunca bloquea. |
| [recetario-cliente.controller.ts](src/recetario/recetario-cliente.controller.ts) | Estado del cliente: guardar/quitar, pausar/continuar, «¡Listo a comer!», calificar e historial. |
| [admin-recetas.controller.ts](src/recetario/admin-recetas.controller.ts) | Alta y edición de las recetas oficiales, bajo `@RequiereSeccion('recetas')`. |
| [recetario.service.ts](src/recetario/recetario.service.ts) | Listado por pestaña (`recetario` = oficiales, `mias` = propias + guardadas, `comunidad` = cualquiera compartida), con búsqueda **por nombre o por ingrediente**. Alta propia y oficial, edición (ingredientes y pasos se reemplazan enteros) y el switch de compartir. Si no hay foto, el emoji sale de la categoría. |
| [recetario-cliente.service.ts](src/recetario/recetario-cliente.service.ts) | Guardadas, pausa, cocinadas, calificaciones e historial de 35 días. **No se puede calificar sin haber marcado «¡Listo a comer!»** antes. `exigirCliente()` comprueba contra la base, no contra el `tipo` del token. |
| [bloqueo-inactividad.service.ts](src/recetario/bloqueo-inactividad.service.ts) | Devuelve **423 Locked** con un código y, cuando toca, el cupón recién emitido. Tres mensajes distintos: prospecto, cliente con 0 pedidos, cliente inactivo. **Se desbloquea solo**: al confirmar un pedido, `ultimoPedido` se actualiza y la comprobación deja de dispararse. |
| [dto/](src/recetario/dto/) | `buscar-recetas.dto.ts` (pestañas y categorías), `guardar-receta.dto.ts` (al menos una categoría), `calificar.dto.ts` (1–5) y `cambiar-compartir.dto.ts`. |

---

## `src/configuracion/` — parámetros del negocio

`@Global`, porque Pedidos y Cashback necesitan el costo de envío, el recargo y los parámetros de cashback.

| Archivo | Qué contiene |
| --- | --- |
| [configuracion.module.ts](src/configuracion/configuracion.module.ts) | Dos controladores, dos servicios. |
| [admin-configuracion.controller.ts](src/configuracion/admin-configuracion.controller.ts) | Horario, parámetros, datos bancarios (GET/PUT) y alta/baja de noticias y avisos. |
| [destacados.controller.ts](src/configuracion/destacados.controller.ts) | `GET /destacados`, `POST /destacados/leido` y `GET /configuracion` (lo que la app del cliente necesita: horario, envío, datos de pago y si está abierto ahora). |
| [configuracion.service.ts](src/configuracion/configuracion.service.ts) | Lee y escribe la fila única (`id = 1`); si no existe, falla claro en vez de inventarse un costo de envío. `estaDentroDeHorario()` entiende un horario que cruza la medianoche (22:00 a 02:00). |
| [destacados.service.ts](src/configuracion/destacados.service.ts) | Noticias y avisos. El contador de no leídos **no es un número guardado**: se calcula comparando la publicación con la última lectura de cada cliente, así que no hay contador global que se desincronice. |
| [dto/configuracion.dto.ts](src/configuracion/dto/configuracion.dto.ts) | `HorarioDto` (con `DiasServicioDto` anidado y validación `HH:MM`), `ParametrosDto`, `BancariosDto`, `NoticiaDto`, `AvisoDto`. |

---

## `src/uploads/` — imágenes

**Dos almacenes, un solo flujo.** Quien sube hace siempre lo mismo: pide firma a
`POST /uploads/firma`, hace `PUT` a la `urlSubida` que le devuelven y guarda la
`urlPublica`. A dónde apuntan esas URL lo decide la API según el entorno, y la
pantalla no tiene que enterarse.

- **Con las seis `S3_*` puestas** el archivo va directo al bucket y no toca la
  API: una foto de 5 MB no atraviesa el servidor.
- **Sin ellas** —o con solo algunas— la API guarda los bytes en la tabla
  `imagenes` y los sirve por `GET /uploads/local/:id`. Es lo que evita que un
  entorno sin bucket contratado se quede sin poder subir fotos.

| Archivo | Qué contiene |
| --- | --- |
| [uploads.module.ts](src/uploads/uploads.module.ts) | Controlador, servicio, y el middleware que deja la imagen cruda en `req.body` para el `PUT` local (ningún parser de serie recoge un `image/png`). Solo en esa ruta: el resto de la API sigue hablando JSON. Traduce el 413 de body-parser. |
| [uploads.controller.ts](src/uploads/uploads.controller.ts) | `POST /uploads/firma`, abierto a cualquier autenticado: el admin sube fotos de producto, el cliente las de sus recetas y el repartidor la evidencia de sus entregas; la carpeta la restringe el DTO (`productos`, `recetas`, `entregas`). Y las dos rutas locales, **públicas**: el `PUT` porque su permiso es la firma de la query —como una URL firmada de S3—, y el `GET` porque es el `src` de un `<img>`, que no puede mandar Bearer. La base de las URL se deduce de la petición (`x-forwarded-proto` detrás de proxy), así que funciona en local y en Railway sin configurar nada; `API_PUBLIC_URL` manda si está. |
| [uploads.service.ts](src/uploads/uploads.service.ts) | Elige almacén y firma (5 min de vigencia). En local la fila no se crea al firmar sino al recibir el `PUT`, para no dejar filas vacías si el usuario cancela; el id va dentro del token, así que una firma no sirve para sobreescribir otra imagen. Escribe con `upsert` para que un reintento no falle por clave repetida. La config S3 se lee en cada llamada, no al arrancar; `forcePathStyle` para R2. |
| [dto/firma.dto.ts](src/uploads/dto/firma.dto.ts) | Carpeta (`productos` \| `recetas`), tipo (jpeg/png/webp) y tamaño máximo de 5 MB. |

---

## `src/health/` — healthcheck

| Archivo | Qué contiene |
| --- | --- |
| [health.controller.ts](src/health/health.controller.ts) | `GET /health` público: estado, uptime y timestamp. Es lo que consulta Railway. |
| [health.module.ts](src/health/health.module.ts) | Lo registra. |

---

## `src/types/` — tipos globales

| Archivo | Qué contiene |
| --- | --- |
| [express.d.ts](src/types/express.d.ts) | Añade `user?: UsuarioAutenticado` a `Express.Request`, que es lo que deja `JwtAuthGuard`. Sin esto, `request.user` no tendría tipo. |

---

## Patrones que se repiten

**Un módulo por dominio, con la misma forma.** `X.module.ts` + uno o más `*.service.ts` (lógica y Prisma) + varios `*.controller.ts` (HTTP y DTOs). Los DTOs en `dto/`, validados con `class-validator`.

**Los controladores se parten por audiencia, no por entidad.** `catalogo.controller.ts` (tienda) y `admin-productos.controller.ts` (panel) comparten el mismo `CatalogoService`. El de admin lleva `@RequiereSeccion`; el de tienda, nada.

**Todo cerrado por defecto.** Los guards son globales; una ruta es pública solo si lleva `@Public()`. La autorización sale de una matriz única, nunca de listas de roles repetidas en cada controlador.

**El dinero es `Prisma.Decimal`.** En JavaScript `0.1 + 0.2 === 0.30000000000000004`. Los `number` aparecen solo al serializar la respuesta HTTP, en los métodos `aDto()` de cada servicio.

**Los importes se recalculan siempre en el backend.** El cliente envía ids y cantidades; los precios salen de la base.

**Los contadores se calculan en vivo.** Ni cupones ni destacados guardan totales: salen de `groupBy` y de comparar fechas. Los contadores desnormalizados se desincronizan.

**Las invariantes viven en el esquema cuando se puede.** `RecetaPausada.clienteId` como PK (una receta en pausa por cliente), `CuponEmitido.usedPedidoId` como `@unique` (un cupón por pedido). Son garantías de la base, no comprobaciones que se puedan olvidar.

**Nada de datos de negocio se pierde al borrar.** Un producto con pedidos no se borra; una fuente con clientes atribuidos, tampoco; eliminar una campaña no invalida los cupones ya emitidos.
