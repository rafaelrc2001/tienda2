# Rapidix API

Backend de Rapidix. Implementa el [SPEC 01](../specs/01-backend-rapidix.md).

- **Fuente de verdad funcional:** `Rapidix_Especificacion_Funcional.docx`
- **Fuente de verdad de implementación:** `rapidix_mockup (2).html` (nombres de campo, fórmulas, orden de las validaciones)

NestJS 11 · TypeScript · Prisma 6 · PostgreSQL

---

## Arranque en local

```bash
npm install
cp .env.example .env          # y rellena DATABASE_URL
npx prisma migrate deploy     # crea las tablas
npx prisma db seed            # datos del prototipo + usuario administrador
npm run start:dev
```

- API: `http://localhost:3000`
- Documentación: `http://localhost:3000/docs`
- Salud: `http://localhost:3000/health`

Si no tienes Postgres a mano, `docker compose up -d` levanta uno con la
configuración que ya trae el `.env.example`.

---

## Variables de entorno

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | sí | Cadena de conexión a PostgreSQL. En Railway usa `DATABASE_PUBLIC_URL` si te conectas desde fuera. |
| `JWT_SECRET` | sí | Firma de los tokens. **La aplicación no arranca sin ella.** |
| `JWT_EXPIRES_IN` | no | Vigencia del token. Por defecto `7d`. |
| `PORT` | no | Puerto de escucha. Railway lo inyecta. |
| `NODE_ENV` | no | En `production` se activan comprobaciones extra (ver abajo). |
| `CORS_ORIGIN` | en producción | Orígenes que pueden llamar a la API, separados por comas. Sin ella solo se permite `http://localhost:5173` (Vite en desarrollo). |
| `APP_PUBLIC_URL` | no | Base de los enlaces de fuentes: `<APP_PUBLIC_URL>/r/CODIGO`. Por defecto `https://rapidix.mx`. |
| `ADMIN_EMAIL` | no | Correo del administrador que crea el seed. Por defecto `admin@rapidix.mx`. |
| `ADMIN_PASSWORD` | en producción | Contraseña de ese administrador. **El seed falla en producción si no está definida.** |
| `NOTIFICATIONS_ALLOW_CONSOLE` | no | Con `true` deja arrancar en producción sin proveedor real de WhatsApp, escribiendo los OTP en el log. Solo para demos. Por defecto `false`. |
| `S3_ENDPOINT` | para imágenes | Endpoint S3-compatible (Cloudflare R2 o AWS S3). |
| `S3_REGION` | no | Por defecto `auto`. |
| `S3_BUCKET` | para imágenes | Nombre del bucket. |
| `S3_ACCESS_KEY_ID` | para imágenes | Credencial de acceso. |
| `S3_SECRET_ACCESS_KEY` | para imágenes | Credencial secreta. |
| `S3_PUBLIC_BASE_URL` | para imágenes | Base pública desde la que se sirven las imágenes. |

Sin las variables `S3_*` la API arranca igual; solo falla `POST /uploads/firma`,
con un 503 que dice qué falta.

### Qué se bloquea con `NODE_ENV=production`

- El seed **se niega** a crear el administrador con la contraseña por defecto.
- El envío de notificaciones por consola **no se registra**: el arranque falla
  si no hay un proveedor real configurado. Es deliberado: esa implementación
  escribe los códigos OTP en el log del servidor. Para desplegar una demo
  mientras WhatsApp está fuera de alcance, `NOTIFICATIONS_ALLOW_CONSOLE=true`
  levanta el bloqueo asumiendo el riesgo; el arranque lo avisa en el log.

---

## Despliegue en Railway

`railway.json` ya está configurado:

- **Build:** `npm ci && npx prisma generate && npm run build`
- **Start:** `npx prisma migrate deploy && node dist/main.js`
- **Healthcheck:** `/health`

Las migraciones se aplican en cada arranque, así que un despliegue nuevo deja
la base al día sola. El seed **no** se ejecuta automáticamente: córrelo a mano
la primera vez con `npx prisma db seed`.

---

## Prospectos: cuándo alguien es cliente

Es cliente **quien ha hecho un pedido**, no quien se registra. El registro por
WhatsApp crea una fila en `prospectos`; `clientes` es la tabla oficial, la que
cuenta para métricas, campañas y segmentación.

Al entrar, el teléfono se busca en las dos tablas:

| Dónde aparece | Qué pasa |
| --- | --- |
| `clientes` | Entra y se le saluda por su nombre. |
| `prospectos` | Entra igual, con el nombre que dio al registrarse. **No se le vuelve a preguntar.** |
| En ninguna | Se le pide el nombre y se crea como prospecto. |

Un teléfono nunca está en las dos: al confirmar su primer pedido, dentro de la
misma transacción, se crea el `Cliente` **conservando el id**, sus cupones
cambian de dueño y la fila de `prospectos` se borra. Conservar el id es lo que
hace que el token que ya tiene el navegador siga valiendo después de comprar,
sin obligar a volver a entrar.

Qué puede hacer un prospecto:

- Navegar el catálogo y armar el carrito.
- Recibir y gastar su **cupón de bienvenida** — cuelga de `prospectoId` y pasa
  a ser suyo como cliente justo a tiempo de usarlo en el pedido que lo convierte.
- Escribir su dirección en Mi Perfil, para que su primer pedido tenga dónde
  entregarse. Esos datos viajan al cliente al convertirse.

Qué no: guardar recetas, abrir el detalle del Recetario (mismo bloqueo que un
cliente con 0 pedidos), acumular cashback ni tener historial de pedidos.

El panel los lista en **Administración → Clientes → pestaña Prospectos**
(`GET /admin/clientes/prospectos`), que es de donde se sacan los registros de
quien se interesó pero todavía no ha comprado.

---

## Estructura

```
src/
  auth/           Login de staff (contraseña) y de cliente (OTP), guards, matriz de permisos
  admin/          Menú del panel y secciones aún sin definir (501)
  catalogo/       Productos, categorías, agotados, importación de Excel
  recetario/      Recetas, estado por cliente, bloqueo por inactividad
  pedidos/        Carrito, validación de cupón y transacción de confirmación
  cupones/        Motor completo: ciclo de vida, campañas, segmentación, fuentes, métricas
  cashback/       Acreditación, movimientos y niveles de fidelidad
  configuracion/  Horario, parámetros, datos bancarios, noticias y avisos
  uploads/        URLs firmadas de S3
  notifications/  Interfaz de envío (WhatsApp) con implementación de consola
  prisma/         Cliente de Prisma
prisma/
  schema.prisma   25 modelos, 8 enums
  migrations/     5 migraciones
  seed.ts         Datos del prototipo
```

---

## Decisiones que conviene conocer antes de tocar el código

**Congelamiento de cupones.** Al emitir un cupón se copian el descuento, el
mínimo, el máximo y la vigencia a su propia fila. Editar la plantilla después
no toca lo ya emitido. Nunca leas esos valores por relación.

**El dinero es `Prisma.Decimal`, nunca `number`.** En JavaScript
`0.1 + 0.2 === 0.30000000000000004`. Los `number` aparecen solo al serializar
la respuesta HTTP.

**El backend recalcula el carrito.** El cliente envía `productoId` y
`cantidad`; los precios salen de la base. Nunca confíes en un importe recibido.

**Los contadores de cupones se calculan en vivo.** `generados` y `utilizados`
salen de un `groupBy` sobre los cupones emitidos, no de columnas. El Word 4.9.5
lo exige y los contadores desnormalizados se desincronizan.

**Las reglas viven en el esquema cuando se puede.** `RecetaPausada` tiene
`clienteId` como clave primaria (una receta en pausa por cliente) y
`CuponEmitido.usedPedidoId` es `@unique` (un cupón por pedido). Son
invariantes que la base garantiza, no comprobaciones que se puedan olvidar.

---

## Supuestos pendientes de confirmar con el cliente

Ninguna de las dos fuentes los define. Están aislados para poder cambiarlos.

1. **Fórmula del cashback** — `subtotal × multiplicadorCashback / 100`, solo si
   el subtotal alcanza `montoMinimoCashback`. El campo se llama "multiplicador
   (x veces)", pero la lectura literal con el valor por defecto `2` daría 200 %
   de cashback. Está en `CashbackService.calcular`; cada acreditación queda en
   `MovimientoCashback`, así que se puede recalcular.
2. **Recargo fuera de horario** — se aplica sobre el subtotal cuando el pedido
   entra fuera de servicio y `atenderFuera` está activo; si está desactivado, el
   pedido se rechaza con 409. El Word define el parámetro pero no cómo se aplica.
   Se guarda en su propia columna `Pedido.recargoFuera` para poder auditarlo.
3. **Umbrales de nivel de fidelidad** — Bronce $0, Plata $30.000, Oro $60.000.
   Valores provisionales; el mockup los tiene escritos a mano y el Word no los
   menciona. Editables desde `/admin/configuracion/niveles`.

---

## Fuera del alcance del SPEC 01

Conectar el mockup HTML a la API · WhatsApp Business API real · pagos ·
notificaciones push · generación de QR · programa de referidos · CAC por canal ·
auditoría de cambios administrativos · lógica de negocio de Rutas, Operaciones
y Finanzas · gasto del saldo de cashback.
