# SPEC 01 — Backend Rapidix

> **Estado:** aprovado 
> **Depende de:** ninguna
> **Fecha:** 2026-09-04
> **Objetivo:** Construir la API y la base de datos que reemplazan el estado en memoria del prototipo HTML, preservando exactamente las reglas de negocio validadas en `Rapidix_Especificacion_Funcional.docx`.

---

## 1. Por qué existe este spec

El prototipo (`rapidix_mockup (2).html`, 3.523 líneas) tiene toda la lógica de negocio validada con el cliente, pero vive en variables de JavaScript del navegador y se pierde al recargar. La sección 8 del Word lo dice explícitamente: hace falta backend, base de datos real y autenticación.

Este spec traduce esa lógica a una API real. La fuente de verdad funcional es el Word; el mockup es la fuente de verdad de los detalles de implementación (nombres de campos, fórmulas, orden de las validaciones). Cuando ambos coinciden, se respetan literalmente.

Hay tres puntos donde ninguna de las dos fuentes decide, y este spec los cierra de forma explícita: la fórmula del cashback, la aplicación del recargo fuera de horario y los umbrales de nivel de fidelidad. Están marcados como supuestos en la sección de Decisiones y en Riesgos.

---

## 2. Alcance

**Dentro:**

- Proyecto NestJS + TypeScript + Prisma sobre PostgreSQL, desplegable en Railway.
- Autenticación: OTP por WhatsApp para el rol Cliente, email + contraseña para los roles Administrador, Ruta, Operaciones y Finanzas. JWT con rol y guards de permiso según la matriz `rolePermissions` del mockup.
- Módulo **Clientes**: alta automática por teléfono, perfil, dirección con lat/lng, contadores derivados de pedidos.
- Módulo **Catálogo**: productos con categoría, unidad, precios, imagen y switch de agotado; alta manual, importación `.xlsx` y solicitudes de producto agotado ("Programar").
- Módulo **Recetario**: recetas oficiales, propias y de comunidad, con ingredientes, pasos, categorías y video; búsqueda por nombre e ingrediente; recetas guardadas, receta en pausa, historial de cocinado de 35 días y calificaciones, todo por cliente.
- Módulo **Pedidos**: entidad Pedido con sus líneas, precio congelado, envío, recargo fuera de horario, descuento por cupón, total y estado.
- Módulo **Cupones** completo: los 5 tipos de ciclo de vida, campañas, segmentación dinámica, restricción por categoría, fuentes de adquisición y métricas en vivo.
- Módulo **Cashback**: acreditación por pedido, movimientos de billetera y niveles de fidelidad configurables.
- Módulo **Configuración**: horario de servicio, parámetros del negocio, datos bancarios, WhatsApp de ayuda, noticias destacadas y avisos con contador de no leídos por cliente.
- Bloqueo del Recetario por inactividad, con emisión automática del cupón INACTIVITY.
- Job diario que marca cupones vencidos como `EXPIRED`.
- Almacenamiento de imágenes en S3-compatible (Cloudflare R2 o AWS S3) mediante URL firmada de subida.
- Seeds con los datos de ejemplo del mockup: 13 productos, 7 recetas oficiales, 3 fuentes, los 5 tipos de ciclo de vida con sus valores por defecto, 3 noticias, 3 avisos, horario y parámetros del negocio.
- Documentación OpenAPI/Swagger generada.

**Fuera de alcance (specs futuros):**

- Modificar `rapidix_mockup (2).html` para consumir la API. El mockup sigue funcionando en memoria; conectarlo es otro spec.
- Integración real con WhatsApp Business API u orquestador tipo n8n. El envío del OTP y de mensajes de cupón se implementa detrás de una interfaz `NotificationSender` con implementación de consola. (Word §8)
- Procesamiento de pagos reales. (Word §8)
- Notificaciones push reales. (Word §8)
- Generación de imágenes QR para las fuentes. El backend devuelve el enlace `rapidix.mx/r/CODIGO`; el QR es otro spec. (Word §8)
- Programa de referidos: atribución y beneficio al referente. La audiencia `REFERRAL` queda declarada en el enum pero nunca califica a nadie. (Word §8)
- Seguimiento de gasto de marketing y cálculo de CAC por canal. (Word §8)
- Registro de auditoría de cambios administrativos. (Word §8)
- Endpoints de negocio de **Rutas**, **Operaciones** y **Finanzas**. Solo existen sus roles y sus permisos de acceso; el Word §3.3 dice que requieren su propia ronda de definición funcional.
- Idempotencia a nivel de infraestructura frente a reintentos de red. (Word §8)

---

## 3. Modelo de datos

Esquema Prisma, en forma resumida. Nombres de campo tomados del mockup para que el porte sea literal.

### Identidad y clientes

```prisma
enum RolUsuario { ADMINISTRADOR RUTA OPERACIONES FINANZAS }

model Usuario {          // staff; nunca clientes
  id           String @id @default(uuid())
  email        String @unique
  passwordHash String
  nombre       String
  rol          RolUsuario
  activo       Boolean @default(true)
}

model Cliente {
  id              String    @id @default(uuid())
  nombre          String
  email           String?
  telefono        String    @unique   // WhatsApp, identificador de login
  fechaNacimiento DateTime?
  quienRecibe     String?
  calle           String?
  colonia         String?
  cp              String?
  ciudad          String?
  estado          String?
  referencias     String?
  lat             Float?
  lng             Float?
  fuenteCodigo    String?             // capturado del enlace rapidix.mx/r/CODIGO
  notificaciones  Boolean   @default(true)
  saldoCashback   Decimal   @default(0)
  nivelId         String?
  pedidos         Int       @default(0)   // derivado, mantenido en la transacción de pedido
  totalGastado    Decimal   @default(0)   // derivado
  primerPedido    DateTime?
  ultimoPedido    DateTime?
  creado          DateTime  @default(now())
}

model CodigoOtp {
  id          String   @id @default(uuid())
  telefono    String
  codigoHash  String
  expiraEn    DateTime
  intentos    Int      @default(0)
  consumidoEn DateTime?
}
```

### Catálogo

```prisma
model Producto {
  id          String  @id @default(uuid())
  nombre      String
  categoria   String            // texto libre; las categorías del sistema se derivan de aquí
  unidad      String
  precioCosto Decimal
  precioVenta Decimal
  imagenUrl   String?
  emoji       String?
  agotado     Boolean @default(false)
}

model SolicitudProducto {        // botón "Programar" en producto agotado
  id         String   @id @default(uuid())
  clienteId  String
  productoId String
  creadoEn   DateTime @default(now())
}
```

### Recetario

```prisma
enum OrigenReceta { RECETARIO PROPIA COMUNIDAD }

model Receta {
  id             String  @id @default(uuid())
  nombre         String
  tiempo         String
  porciones      Int
  imagenUrl      String?
  emoji          String?
  youtube        String?
  categorias     String[]          // 'desayuno' | 'comida' | 'cena'
  autorNombre    String
  autorClienteId String?           // null en recetas oficiales
  origin         OrigenReceta
  compartir      Boolean @default(false)
}

model RecetaIngrediente  { id String @id @default(uuid())  recetaId String  nombre String  cantidad String  orden Int }
model RecetaPaso         { id String @id @default(uuid())  recetaId String  texto String   orden Int }

model RecetaGuardada     { clienteId String  recetaId String  creadoEn DateTime @default(now())  @@id([clienteId, recetaId]) }
model RecetaPausada      { clienteId String @id  recetaId String  pausadaEn DateTime @default(now()) }
model RecetaCocinada     { id String @id @default(uuid())  clienteId String  recetaId String  cocinadaEn DateTime @default(now()) }
model RecetaCalificacion { clienteId String  recetaId String  puntuacion Int  creadoEn DateTime @default(now())  @@id([clienteId, recetaId]) }
```

`RecetaPausada` tiene `clienteId` como clave primaria: eso hace imposible por esquema tener dos recetas en pausa a la vez, que es la regla del Word §6.4.

### Pedidos

```prisma
enum EstadoPedido { CONFIRMADO EN_RUTA ENTREGADO CANCELADO }

model Pedido {
  id               String  @id @default(uuid())
  folio            String  @unique          // ORD-000123
  clienteId        String
  subtotal         Decimal
  envio            Decimal
  recargoFuera     Decimal @default(0)
  descuento        Decimal @default(0)
  total            Decimal
  cuponId          String?                  // cupón emitido que se canjeó
  cashbackGenerado Decimal @default(0)
  estado           EstadoPedido @default(CONFIRMADO)
  direccion        Json                     // snapshot de la dirección del cliente
  creadoEn         DateTime @default(now())
}

model PedidoItem {
  id             String  @id @default(uuid())
  pedidoId       String
  productoId     String
  nombre         String        // snapshot
  categoria      String        // snapshot, necesario para auditar la restricción por categoría
  unidad         String
  precioUnitario Decimal       // congelado al momento del pedido
  cantidad       Int
}
```

### Motor de cupones

```prisma
enum TipoDescuento { FIXED PERCENTAGE }
enum EstadoCupon   { ACTIVE USED EXPIRED CANCELLED }
enum OrigenCupon   { LIFECYCLE CAMPAIGN }
enum TipoAudiencia { ALL NEW_CUSTOMERS EXISTING_CUSTOMERS SOURCE REFERRAL SEGMENT }
enum TipoFuente    { FACEBOOK INSTAGRAM INFLUENCER QR REFERIDO GOOGLE OTRO }

model TipoCuponCicloVida {           // 5 filas fijas; el code no es editable
  code                  String  @id  // WELCOME | SECOND_PURCHASE | TICKET_INCREASE | INACTIVITY | BIRTHDAY
  name                  String
  title                 String
  description           String
  customerMessage       String
  discountType          TipoDescuento
  discountValue         Decimal
  minimumOrderAmount    Decimal
  maximumOrderAmount    Decimal?
  validityDays          Int
  usageLimitPerCustomer Int
  inactivityDays        Int?         // solo INACTIVITY
  birthdayWindowDays    Int?         // solo BIRTHDAY
  isActive              Boolean @default(true)
}

model Campania {
  id                    String  @id @default(uuid())
  name                  String  @unique   // nombre interno, no se repite
  title                 String
  description           String?
  customerMessage       String?
  discountType          TipoDescuento
  discountValue         Decimal
  minimumOrderAmount    Decimal
  maximumOrderAmount    Decimal?
  startsAt              DateTime?
  endsAt                DateTime?
  usageLimitTotal       Int      @default(0)   // 0 = sin límite
  usageLimitPerCustomer Int      @default(1)
  targetType            TipoAudiencia @default(ALL)
  sourceCode            String?
  segmentRules          Json     @default("[]")  // [{ attr, op, value }]
  categorias            String[]                 // vacío = sin restricción
  isActive              Boolean  @default(true)
  creado                DateTime @default(now())
}

model CuponEmitido {
  id                 String  @id @default(uuid())
  code               String  @unique      // RPD + 4 chars de ABCDEFGHJKLMNPQRSTUVWXYZ23456789
  clienteId          String
  sourceKind         OrigenCupon
  sourceCode         String               // code del tipo o name de la campaña
  title              String
  description        String?
  customerMessage    String?
  discountType       TipoDescuento        // congelado
  discountValue      Decimal              // congelado
  minimumOrderAmount Decimal              // congelado
  maximumOrderAmount Decimal?             // congelado
  issuedAt           DateTime @default(now())
  expiresAt          DateTime
  status             EstadoCupon @default(ACTIVE)
  usedAt             DateTime?
  usedPedidoId       String?
  discountApplied    Decimal?
}

model FuenteAdquisicion {
  id       String @id @default(uuid())
  name     String
  type     TipoFuente @default(OTRO)
  code     String @unique
  isActive Boolean @default(true)
}
```

Los contadores `generados` y `utilizados` **no** se guardan como columna. Se calculan en vivo desde `CuponEmitido`, como exige el Word §4.9.5 ("no son cifras de ejemplo").

Atributos válidos de `segmentRules.attr`: `pedidos`, `totalGastado`, `diasSinComprar`, `diasComoCliente`, `ciudad`, `estado`, `mesCumpleanos`.
Operadores válidos de `segmentRules.op`: `>`, `>=`, `<`, `<=`, `=`, y `contiene` solo para `ciudad` y `estado`.

### Configuración y contenido

```prisma
model ConfiguracionNegocio {        // fila única, id = 1
  id                    Int     @id @default(1)
  diasServicio          Json    // {lun:true, ..., dom:false}
  abre                  String  // "08:00"
  cierra                String  // "18:00"
  atenderFuera          Boolean
  incrementoFuera       Decimal // %
  whatsappAyuda         String?
  costoEnvio            Decimal
  montoEnvioGratis      Decimal
  multiplicadorCashback Decimal
  montoMinimoCashback   Decimal
  banco                 String?
  beneficiario          String?
  numeroCuenta          String?
}

model NivelFidelidad     { id String @id @default(uuid())  nombre String  umbralGasto Decimal  orden Int }
model MovimientoCashback { id String @id @default(uuid())  clienteId String  pedidoId String?  monto Decimal  concepto String  creadoEn DateTime @default(now()) }

model NoticiaDestacada   { id String @id @default(uuid())  badge String  titulo String  desc String  publicadoEn DateTime @default(now()) }
model Aviso              { id String @id @default(uuid())  icon String   titulo String  desc String  publicadoEn DateTime @default(now()) }
model LecturaDestacados  { clienteId String @id  ultimaLectura DateTime }
```

El contador de no leídos de Destacados es `count(NoticiaDestacada donde publicadoEn > ultimaLectura) + count(Aviso donde publicadoEn > ultimaLectura)`.

### Reglas de negocio que el modelo debe preservar (Word §5)

1. **Congelamiento:** al emitir un `CuponEmitido` se copian `discountType`, `discountValue`, `minimumOrderAmount`, `maximumOrderAmount` y la fecha de expiración vigentes. Editar la plantilla después no toca los cupones ya emitidos.
2. **Un cupón por pedido.** `Pedido.cuponId` es un solo campo, no una lista.
3. El **mínimo de compra** se evalúa sobre el subtotal **antes** del descuento. El error indica cuánto falta, no solo el mínimo.
4. **WELCOME** pasa a `CANCELLED` automáticamente al confirmarse un pedido si seguía `ACTIVE` y no se usó en ese pedido.
5. **SECOND_PURCHASE** se emite justo cuando `Cliente.pedidos` pasa a valer 1.
6. **INACTIVITY** no se emite si ya existe uno `ACTIVE` o `USED` del mismo tipo para ese cliente.
7. **BIRTHDAY** se emite una sola vez por cliente y por año natural, dentro de la ventana `±birthdayWindowDays`.
8. Una campaña `SEGMENT` **sin reglas no califica a nadie**.
9. Una campaña `ALL` se emite a cualquier cliente que inicie sesión o abra Cupones, incluidos los que ya existían antes de crearla.
10. **Restricción por categoría:** si la campaña tiene categorías, el carrito debe incluir al menos un producto de esas categorías.
11. **Bloqueo del Recetario:** solo en rol Cliente, solo al abrir el detalle de una receta, si el cliente tiene 0 pedidos o si pasaron más días que `INACTIVITY.inactivityDays` desde su último pedido. Se desbloquea al confirmar un pedido.
12. Estados de un cupón: `ACTIVE`, `USED`, `EXPIRED`, `CANCELLED`.

---

## 4. Plan de implementación

Cada paso deja el proyecto arrancando y es commiteable por sí solo.

1. **Andamiaje.** `nest new rapidix-api`, TypeScript estricto, `.env.example` con `DATABASE_URL`, `JWT_SECRET`, `S3_*`. `docker-compose.yml` con Postgres para desarrollo local. Prueba: `npm run start:dev` responde 200 en `/health`.
2. **Prisma + esquema base.** Instalar Prisma, escribir `schema.prisma` con Usuario, Cliente y CodigoOtp, primera migración. Prueba: `npx prisma migrate dev` y `npx prisma studio` muestran las tablas.
3. **Resto del esquema.** Añadir catálogo, recetario, pedidos, cupones, configuración y contenido a `schema.prisma`. Segunda migración. Prueba: la migración corre limpia sobre base vacía.
4. **Seeds.** `prisma/seed.ts` con los 13 productos, 7 recetas oficiales con sus ingredientes y pasos, 3 fuentes, los 5 tipos de ciclo de vida con los valores por defecto del mockup, 3 noticias, 3 avisos, la fila de `ConfiguracionNegocio` y 3 niveles de fidelidad. Prueba: `npx prisma db seed` y `GET /productos` devuelve 13.
5. **Auth staff.** `POST /auth/staff/login` con email y contraseña (argon2), emite JWT con `sub` y `rol`. `JwtAuthGuard` y `RolesGuard`. Seed de un usuario administrador. Prueba: el login devuelve token; un endpoint protegido rechaza sin token.
6. **Auth cliente por OTP.** `POST /auth/cliente/solicitar-codigo` (OTP de 6 dígitos hasheado, expira en 5 minutos, máximo 5 intentos) y `POST /auth/cliente/verificar-codigo` (si el teléfono no existe, pide `nombre` y da de alta al cliente). Interfaz `NotificationSender` con implementación `ConsoleNotificationSender`. Prueba: solicitar código, leerlo del log, verificar y recibir JWT de rol cliente.
7. **Matriz de permisos.** Decorador `@Roles()` alimentado por la matriz `rolePermissions` del mockup: administrador ve todo, cliente solo lo suyo, ruta solo rutas, operaciones solo operaciones, finanzas solo finanzas y clientes. Prueba: un token de rol `RUTA` recibe 403 en `/admin/productos`.
8. **Módulo Catálogo.** CRUD de productos, `PATCH /admin/productos/:id/agotado`, `GET /productos` agrupado por categoría con búsqueda por nombre, `GET /categorias` derivado de los productos, `POST /productos/:id/programar`. Validación: nombre, categoría y precio de venta obligatorios. Prueba: crear producto sin precio devuelve 400.
9. **Subida de imágenes.** `POST /uploads/firma` devuelve la URL firmada de S3 y la URL pública final. Productos y recetas guardan solo la URL. Prueba: subir un PNG con la URL firmada y leerlo por la URL pública.
10. **Importación de Excel.** `POST /admin/productos/importar` recibe multipart `.xlsx`, valida las columnas `Categoria`, `Producto`, `Unidad`, `Precio de costo`, `Precio de venta` (e `Imagen` opcional) y devuelve por fila si se importó o por qué falló. `GET /admin/productos/plantilla` devuelve el CSV de ejemplo. Prueba: importar un archivo con una fila sin precio y ver esa fila reportada como error sin abortar las demás.
11. **Módulo Recetario — lectura.** `GET /recetas` con filtro por categoría y pestaña (oficial, mías, comunidad), búsqueda por nombre o ingrediente, y `GET /recetas/:id` con ingredientes, pasos y promedio de calificación. Prueba: buscar "pollo" devuelve la receta cuyo ingrediente es "Pechuga de pollo".
12. **Módulo Recetario — escritura.** Alta y edición de recetas propias del cliente y de recetas oficiales por administrador, con ingredientes y pasos ordenados. Validación: nombre obligatorio y al menos una categoría. Switch de compartir con la comunidad. Prueba: guardar receta sin categoría devuelve 400.
13. **Estado del recetario por cliente.** Guardar/quitar de Mis Recetas, pausar/continuar receta (una a la vez), marcar "¡Listo a comer!" y calificar. La calificación solo se acepta si existe un `RecetaCocinada` de ese cliente para esa receta. `GET /recetario/historial` devuelve los últimos 35 días. Prueba: calificar sin haber cocinado devuelve 409.
14. **Módulo Configuración.** `GET/PUT /admin/configuracion/horario`, `/parametros` y `/bancarios`, más CRUD de noticias y avisos. `GET /destacados` con contador de no leídos y `POST /destacados/leido`. Prueba: publicar una noticia sube el contador de no leídos del cliente a 1; abrir Destacados lo baja a 0.
15. **Motor de cupones — emisión.** `CouponsService` con `issueCoupon` (congelamiento), `generateUniqueShortCode`, `hasActiveOrUsedCoupon` y los cuatro disparadores `maybeIssueWelcome`, `maybeIssueSecondPurchase`, `maybeIssueInactivity` y `maybeIssueBirthday`, portados literalmente del mockup. Prueba: un cliente nuevo recibe WELCOME al registrarse y no recibe un segundo WELCOME al volver a entrar.
16. **Motor de cupones — campañas y segmentación.** CRUD de campañas con validación de nombre único y de que `SEGMENT` traiga al menos una regla; `evaluateSegmentRule` y `clientMatchesSegment` portados del mockup; `issueEligibleCampaignCoupons` invocado al iniciar sesión y al abrir `GET /cupones`. Prueba: una campaña `SEGMENT` con regla `totalGastado >= 500` emite cupón solo a los clientes que la cumplen.
17. **Fuentes de adquisición y métricas.** CRUD de fuentes con código único y enlace `rapidix.mx/r/CODIGO`; captura de `fuenteCodigo` en el alta de cliente; audiencia `SOURCE` habilitada. `GET /admin/cupones/metricas` con generados, utilizados, % de utilización, descuento total otorgado y clientes con al menos un cupón, más el desglose por tipo y campaña, todo calculado en vivo. Prueba: emitir 2 cupones y usar 1 devuelve 50 % de utilización.
18. **Validación de cupón en carrito.** `POST /carrito/validar-cupon` recibe las líneas del carrito y el código, y devuelve el descuento o el motivo del rechazo, respetando el orden de validación del mockup: existe, pertenece al cliente, `ACTIVE`, no vencido, subtotal ≥ mínimo (indicando cuánto falta), subtotal ≤ máximo, y restricción por categoría. Prueba: subtotal por debajo del mínimo devuelve el faltante exacto.
19. **Módulo Pedidos.** `POST /pedidos` en una transacción: recalcula el subtotal desde los precios de la base (nunca desde el cliente), rechaza productos agotados, calcula envío, aplica recargo fuera de horario, revalida el cupón, crea Pedido y PedidoItem, marca el cupón como `USED`, cancela el WELCOME activo sobrante, actualiza los contadores del cliente y dispara `maybeIssueSecondPurchase`. `GET /pedidos/mios` y `GET /admin/pedidos`. Prueba: confirmar un pedido con cupón deja el cupón en `USED` con `usedPedidoId` apuntando al pedido creado.
20. **Cashback y niveles.** Dentro de la misma transacción del pedido: si el subtotal alcanza `montoMinimoCashback`, acredita `subtotal × multiplicadorCashback / 100`, crea el `MovimientoCashback` y recalcula el nivel del cliente contra `NivelFidelidad`. `GET /perfil/cashback` devuelve saldo, nivel actual, próximo nivel, porcentaje de progreso y monto faltante. CRUD de niveles en administración. Prueba: un pedido de $1.000 con multiplicador 2 acredita $20 y crea un movimiento.
21. **Bloqueo por inactividad.** `GET /recetas/:id` devuelve 423 con el mensaje de bloqueo si el cliente tiene 0 pedidos o superó `inactivityDays`, y emite el cupón INACTIVITY en ese momento. Prueba: un cliente con 0 pedidos recibe 423 al abrir una receta y aparece su cupón INACTIVITY; tras confirmar un pedido, la misma llamada devuelve 200.
22. **Job de expiración.** Tarea programada diaria que marca como `EXPIRED` los cupones `ACTIVE` con `expiresAt` en el pasado. Prueba: insertar un cupón vencido, ejecutar el job manualmente y ver el estado en `EXPIRED`.
23. **Swagger y despliegue.** Decoradores `@ApiTags`/`@ApiResponse` en todos los controladores, `/docs` publicado, `railway.json` o `Procfile` con `prisma migrate deploy` en el arranque, y `README.md` con las variables de entorno. Prueba: `/docs` lista todos los endpoints y el despliegue en Railway responde `/health`.

---

## 5. Criterios de aceptación

- [X] `npx prisma migrate deploy` corre limpio sobre una base Postgres vacía y `npx prisma db seed` deja 13 productos, 7 recetas oficiales, 3 fuentes y los 5 tipos de ciclo de vida.
- [ ] `POST /auth/cliente/solicitar-codigo` con un teléfono nuevo, seguido de `verificar-codigo` con nombre, crea el cliente y devuelve un JWT de rol cliente.
- [ ] Un cliente recién creado tiene exactamente un cupón `ACTIVE` con `sourceCode = WELCOME`.
- [ ] Volver a iniciar sesión con ese mismo teléfono no genera un segundo cupón WELCOME.
- [ ] Un JWT de rol `RUTA` recibe 403 al llamar `GET /admin/productos`.
- [ ] `POST /admin/productos` sin `precioVenta` devuelve 400 con el campo señalado.
- [ ] `POST /admin/productos/importar` con un `.xlsx` de 3 filas donde una no tiene precio importa 2 y devuelve la fila fallida con su motivo.
- [ ] `GET /recetas?q=pollo` devuelve la receta cuyo ingrediente es "Pechuga de pollo", no solo las que llevan "pollo" en el nombre.
- [ ] `POST /recetas/:id/calificar` sin haber marcado "¡Listo a comer!" devuelve 409.
- [ ] Pausar una segunda receta reemplaza la anterior: `GET /recetario/pausada` nunca devuelve más de una.
- [ ] `GET /recetario/historial` solo devuelve entradas de los últimos 35 días.
- [ ] Un cliente con 0 pedidos recibe 423 en `GET /recetas/:id` y queda con un cupón `ACTIVE` de `sourceCode = INACTIVITY`.
- [ ] Tras confirmar un pedido, ese mismo `GET /recetas/:id` devuelve 200.
- [ ] `POST /carrito/validar-cupon` con subtotal $120 y cupón de mínimo $150 devuelve un mensaje que contiene el faltante de $30.
- [ ] Editar `discountValue` de un tipo de ciclo de vida no cambia el `discountValue` de un cupón ya emitido.
- [ ] Un cupón de campaña con `categorias = ["Carnes"]` es rechazado si el carrito solo tiene productos de "Bebidas".
- [ ] `POST /pedidos` con un cupón aplicado deja el cupón en `USED`, con `usedAt`, `usedPedidoId` y `discountApplied` poblados.
- [ ] Tras el primer pedido de un cliente, existe un cupón `ACTIVE` de `sourceCode = SECOND_PURCHASE`.
- [ ] Tras el primer pedido, cualquier cupón WELCOME que siguiera `ACTIVE` queda en `CANCELLED`.
- [ ] `POST /pedidos` con un precio manipulado en el body cobra el precio de la base de datos, no el enviado.
- [ ] `POST /pedidos` con un producto marcado agotado devuelve 409.
- [ ] Un pedido de subtotal $1.000 con `multiplicadorCashback = 2` y `montoMinimoCashback = 200` acredita $20 y crea un `MovimientoCashback`.
- [ ] Una campaña `SEGMENT` sin reglas no emite ningún cupón.
- [ ] Una campaña `ALL` creada hoy emite cupón a un cliente registrado ayer la próxima vez que inicie sesión.
- [ ] Crear una campaña con un `name` ya existente devuelve 400.
- [ ] Crear una fuente con un `code` ya existente devuelve 400.
- [ ] `GET /admin/cupones/metricas` con 2 cupones emitidos y 1 usado devuelve 50 % de utilización.
- [ ] El job de expiración marca `EXPIRED` un cupón `ACTIVE` con `expiresAt` en el pasado.
- [ ] Publicar una noticia sube a 1 el contador de no leídos del cliente; `POST /destacados/leido` lo baja a 0.
- [ ] `/docs` renderiza el Swagger con todos los módulos y el servicio desplegado en Railway responde `GET /health` con 200.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** NestJS + TypeScript + Prisma sobre Postgres. El mockup ya es JavaScript, así que el motor de cupones se porta casi línea por línea. Los módulos por dominio ordenan seis áreas de negocio y los guards de rol implementan la matriz `rolePermissions` sin código a mano.
- **No:** Express o Fastify pelados. Con 6 dominios y 12 reglas de negocio, montar a mano la estructura, la validación y la autorización cuesta más de lo que ahorra.
- **No:** FastAPI o Laravel. Obligarían a reescribir desde cero la lógica de cupones que ya está validada en JavaScript.
- **Sí:** OTP por WhatsApp para el cliente y email + contraseña para el staff. El Word §8 exige autenticación real, pero su tabla de roles §2.4 describe al staff entrando sin credenciales — eso es una descripción del prototipo, no un requisito de producción. El OTP conserva el flujo validado (HU-C02, HU-C03) y cierra el hueco.
- **No:** replicar el "acceso directo" del prototipo para administrador, ruta, operaciones y finanzas. Sería un panel de administración abierto a internet.
- **No:** email y contraseña también para el cliente. Rompe HU-C02 y HU-C03, que sí están validadas con el cliente final.
- **Sí:** entidad `Pedido` con sus líneas. Ni el Word §7 ni el mockup la tienen (solo llevan contadores), pero `usedOrderId`, "Mis Pedidos", Rutas y Finanzas la necesitan. Sin ella, `usedOrderId` apuntaría a un identificador inventado.
- **Sí:** snapshot de `nombre`, `categoria`, `unidad` y `precioUnitario` en `PedidoItem`. Un cambio de precio o de categoría no debe reescribir la historia, y la categoría en el ítem permite auditar después la restricción por categoría del cupón.
- **Sí:** el backend recalcula el subtotal desde los precios de la base en cada pedido. El mockup confía en el carrito del navegador; en una API eso es manipulable.
- **Sí:** almacenamiento S3-compatible con URL firmada de subida. El disco de Railway es efímero y el base64 en Postgres degrada cada listado de catálogo.
- **No:** base64 en la base de datos, aunque sea lo que hace el mockup hoy.
- **Sí:** `generados` y `utilizados` calculados en vivo desde `CuponEmitido`, no como columnas. El Word §4.9.5 exige números reales, y los contadores desnormalizados se desincronizan.
- **Sí:** `RecetaPausada` con `clienteId` como clave primaria. Hace estructuralmente imposible violar la regla de "solo una receta en pausa a la vez".
- **Sí:** fórmula de cashback `subtotal × multiplicadorCashback / 100`, acreditada solo si `subtotal ≥ montoMinimoCashback`. **Supuesto:** ninguna de las dos fuentes define la fórmula. El nombre del campo dice "multiplicador (x veces)", pero interpretarlo literalmente con el valor por defecto 2 daría 200 % de cashback. La lectura como porcentaje es la única coherente con los defaults del mockup. Requiere confirmación del cliente antes de implementar el paso 20.
- **Sí:** el recargo fuera de horario se aplica sobre el subtotal cuando el pedido entra fuera de los días u horas de servicio y `atenderFuera` está activo; si `atenderFuera` está desactivado, el pedido se rechaza con 409. **Supuesto:** el Word define el parámetro (§4.9 y §6.8) pero nunca dice cómo se aplica, y el mockup no lo implementa.
- **Sí:** `NivelFidelidad` como tabla configurable con umbral de gasto acumulado. Los niveles Bronce y Plata están hardcodeados en el mockup y no se definen en el Word; una tabla evita volver a hardcodearlos. Los umbrales del seed son valores iniciales a confirmar.
- **Sí:** capturar `fuenteCodigo` en el alta de cliente desde el enlace `rapidix.mx/r/CODIGO`. Es lo mínimo para que la audiencia `SOURCE` funcione; sin ello, las fuentes solo generarían enlaces decorativos. El mockup no rastrea atribución.
- **No:** audiencia `REFERRAL` funcional. Queda en el enum pero nunca califica, porque el Word §8 excluye explícitamente el programa de referidos.
- **Sí:** interfaz `NotificationSender` con implementación de consola. Permite construir y probar el flujo de OTP sin la integración de WhatsApp que el Word §8 excluye, y deja el punto de enchufe listo.
- **Sí:** el backend procesa el `.xlsx`. La validación de columnas del Word §6.6 queda en un solo lugar y sirve a cualquier frontend futuro.
- **Sí:** un solo spec para todo el backend, aunque toque seis dominios. Decisión explícita del usuario: el alcance es el que define el Word.
- **No:** conectar el mockup HTML a la API en este spec. Son 3.523 líneas de reescritura y dispararía el alcance; va en su propio spec.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| La fórmula del cashback es un supuesto. Si el cliente quería otra cosa, el saldo de todos los clientes queda mal. | Está aislada en un solo método del `CashbackService` y todo movimiento queda registrado en `MovimientoCashback`, así que se puede recalcular. Confirmar con el cliente antes del paso 20. |
| La aplicación del recargo fuera de horario también es un supuesto y afecta al total cobrado. | Se guarda en su propia columna `Pedido.recargoFuera`, separada del subtotal y del envío, para poder auditarlo o revertirlo. |
| Los umbrales de nivel de fidelidad no existen en ninguna fuente. | Tabla `NivelFidelidad` editable desde administración; los valores del seed se marcan como provisionales en el `README`. |
| Recalcular métricas de cupones en vivo puede volverse lento con muchos cupones emitidos. | Índices en `CuponEmitido(sourceKind, sourceCode, status)` y en `(clienteId, status)`. Si crece, se añade una vista materializada en un spec posterior. |
| `issueEligibleCampaignCoupons` corre en cada login y en cada apertura de Cupones, y recorre todas las campañas activas. | Filtrar en SQL por campañas activas y dentro de vigencia antes de evaluar segmentos en memoria. Índice en `Campania(isActive, startsAt, endsAt)`. |
| Dos pedidos simultáneos del mismo cliente podrían canjear el mismo cupón dos veces. | La transacción del pedido bloquea la fila del cupón con `SELECT ... FOR UPDATE` y verifica `status = ACTIVE` dentro de la transacción. |
| El OTP sin envío real permite iniciar sesión como cualquiera si el log es accesible. | En producción la implementación de consola queda deshabilitada por variable de entorno, y el arranque falla si `NODE_ENV=production` sin un sender real configurado. |
| Rutas, Operaciones y Finanzas están sin definir, pero sus roles ya existen. | Sus endpoints devuelven 501 con un mensaje explícito. El modelo de `Pedido` ya contempla el enum `EstadoPedido` que esas secciones necesitarán. |

---

## Lo que **no** está en este spec

- Conectar `rapidix_mockup (2).html` a la API.
- Integración real con WhatsApp Business API o n8n.
- Pagos reales.
- Notificaciones push reales.
- Generación de imágenes QR.
- Programa de referidos con atribución y beneficio al referente.
- Gasto de marketing y CAC por canal.
- Registro de auditoría de cambios administrativos.
- Lógica de negocio de Rutas, Operaciones y Finanzas.

Cada uno de esos, si entra, va en su propio spec.
