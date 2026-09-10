# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué hay en el repo

Dos proyectos npm independientes (no hay `package.json` en la raíz ni workspaces): cada comando se corre dentro de su carpeta.

- `rapidix-api/` — NestJS 11 + Prisma 6 + PostgreSQL. Implementa `specs/01-backend-rapidix.md`.
- `rapidix-web/` — Vue 3 (`<script setup>`) + Vite + Pinia + Vue Router + Vitest. Implementa `specs/02-frontend-vue.md`. Una sola SPA para clientes y personal.
- `Rapidix_Especificacion_Funcional.docx` es la fuente de verdad funcional (los comentarios citan "Word 4.3", "Word 5, regla 4"…). `rapidix_mockup (2).html` lo es de nombres de campo, fórmulas, orden de validaciones y diseño; no se sirve desde ningún sitio.
- `rapidix-api/ESTRUCTURA.md` es el mapa archivo por archivo del backend; los dos `README.md` explican variables de entorno, despliegue en Railway y decisiones de negocio.

Todo el código, nombres y comentarios están en español. Los comentarios explican el *por qué*; mantener esa densidad. En `rapidix-api` los comentarios se escriben sin acentos ("decision", "tambien"); en `rapidix-web` sí llevan acentos. Prettier: comillas simples, comas finales, 100 columnas.

## Comandos

### rapidix-api
```bash
docker compose up -d                 # Postgres 16 local con las credenciales de .env.example
npx prisma migrate deploy            # aplica migraciones pendientes
npx prisma db seed                   # datos del prototipo + admin (idempotente, no pisa datos)
npm run start:dev                    # http://localhost:3000 · Swagger en /docs · /health
npx tsc --noEmit -p tsconfig.json    # comprobar tipos
npm run build                        # nest build -> dist/
npm test                             # jest (rootDir src, *.spec.ts); hoy no hay specs en la API
npx jest ruta/al/archivo.spec.ts     # una sola prueba
```
- Tras tocar `prisma/schema.prisma` hay que correr `npx prisma generate` o el cliente tipado no verá los campos nuevos.
- Las migraciones se escriben a mano como carpetas `prisma/migrations/<timestamp>_<nombre>/migration.sql` (con comentarios y, si hace falta, `UPDATE` de siembra). Se aplican con `migrate deploy`; en producción las aplica el arranque (`start:prod`).
- Corre la CLI de Prisma desde `rapidix-api/`: desde `rapidix-web/` `npx prisma` resuelve otra versión.
- Con `AUTH_DEMO_LOGIN=true`, `POST /auth/demo/entrar {"rol":"CLIENTE"|"ADMINISTRADOR"|...}` devuelve un token sin credenciales; útil para probar endpoints con curl. `AUTH_OTP_BYPASS=true` devuelve el OTP en la respuesta.

### rapidix-web
```bash
npm run dev                          # http://localhost:5173 (la API solo acepta este origen si no hay CORS_ORIGIN)
npm run build                        # vue-tsc -b && vite build
npm test                             # vitest run (jsdom, src/**/*.spec.ts)
npx vitest run src/stores/carrito.spec.ts      # un archivo
npx vitest run -t "descarta el carrito"        # por nombre de prueba
```
`VITE_API_URL` se incrusta en el build: cambiarla exige recompilar. Alias `@` → `src/`.

## Arquitectura del backend

**Todo cerrado por defecto.** `JwtAuthGuard` y `RolesGuard` son `APP_GUARD` globales (`app.module.ts`). Una ruta sin token solo pasa con `@Public()`; `@AutenticacionOpcional()` deja pasar sin token pero rellena `@UsuarioActual()` si viene uno válido (y se comprueba antes que `@Public`). El panel se autoriza con `@RequiereSeccion('x')` contra la matriz única `PERMISOS_POR_ROL` (`src/auth/permisos.ts`); nunca listas de roles sueltas. Las rutas de cliente que no son sección del panel comprueban `usuario.rol !== ROL_CLIENTE` a mano en el controlador.

**Cliente vs prospecto.** Un token de rol `CLIENTE` puede apuntar (`sub`) a `clientes` o a `prospectos`. Es cliente quien ha comprado: el primer pedido convierte al prospecto dentro de la transacción conservando el **mismo id**, mueve sus cupones y borra la fila de `prospectos`. Por eso los servicios de perfil/carrito buscan en las dos tablas y los campos del perfil están duplicados a propósito en ambas.

**Dinero.** Siempre `Prisma.Decimal` en la lógica; se convierte a `number` solo en los `aDto()` al serializar. Los precios nunca vienen del cliente: llegan `productoId` + `cantidad` y el backend resuelve contra la base. `CarritoService.calcularCarrito` es el único sitio con la aritmética de envío/recargo/total/cashback y lo comparten `POST /carrito/previsualizar` y `POST /pedidos` para que no diverjan. `resolver()` lanza (checkout); `resolverTolerante()` marca y avisa (previsualización).

**Módulos por dominio, controladores por audiencia.** `catalogo.controller.ts` (tienda) y `admin-productos.controller.ts` (panel) comparten `CatalogoService`. El orden de declaración de rutas importa: rutas literales como `productos/recomendados` van antes de `productos/:id`, y `AdminImportacionController` se registra antes que `AdminProductosController`.

**Validación.** `ValidationPipe` global con `whitelist` + `forbidNonWhitelisted` + `transform`: un campo que no está en el DTO devuelve 400. Los errores de negocio llevan `code` en el cuerpo (`MINIMO_NO_ALCANZADO`, `RECETARIO_BLOQUEADO`…) que el frontend interpreta.

**Invariantes y datos.** Las reglas se ponen en el esquema cuando se puede (`RecetaPausada.clienteId` PK, `CuponEmitido.usedPedidoId @unique`). Los cupones emitidos congelan sus condiciones: no se leen por relación con la plantilla. Los contadores (cupones, destacados) se calculan en vivo con `groupBy`. Un producto con pedidos no se borra (se marca agotado). `ConfiguracionNegocio` es una fila única `id = 1`; `controlInventario` nace apagado y con él apagado `aptInventario` está en cero y no se descuenta nada.

**Catálogo de la Tienda.** El orden personalizado vive en `RecomendacionesService` (`GET /productos/recomendados`, token opcional): familias del último pedido arriba, luego `Categoria.prioridad`; dentro de la familia, agotados al final → último comprado → frecuencia → `Producto.rol` → id. La interfaz no reordena.

## Arquitectura del frontend

- **`src/api/http.ts` es la única capa de red.** Inyecta el Bearer, traduce errores de Nest a `ErrorApi` (`mensaje`, `codigo`, `porCampo()` para repartir errores del `ValidationPipe` bajo cada campo) y ante un 401 llama al manejador de sesión expirada. Ninguna pantalla usa `fetch` directo. Los tipos del cable están en `src/api/tipos.ts`.
- **El frontend no lleva copia de los permisos.** Lo que ve cada rol sale de `GET /admin/menu`; `router/guard.ts` es una función pura (`decidir`) probada en `guard.spec.ts`. Metas de ruta: `publica`, `soloCliente`, `seccion`, `titulo`.
- **El backend calcula, la interfaz pinta.** Ningún total se suma en el navegador. El carrito (`stores/carrito.ts`) persiste solo `productoId`/`cantidad` (+ dueño) en `localStorage`, se sincroniza con `PUT /perfil/carrito` con debounce y usa `POST /carrito/subtotal` (público) o `/carrito/previsualizar` (cliente) para los importes. Las respuestas viejas se descartan por número de petición.
- **Todo lo guardado en el navegador lleva el prefijo `rapidix.`**; cerrar sesión borra el prefijo entero y llama a `olvidar()` de los stores.
- **Layout.** `AppLayout.vue` tiene altura fija: quien hace scroll es `.app-screen`, no `window`. La app de cliente es una columna de `--ancho-cliente` (430px) y el admin de `--ancho-admin`.
- **Estilos.** Los colores, fuentes y radios son los tokens de `src/assets/tokens.css` (portados del mockup: `--cream`, `--terracotta`, `--gold`, `--navy`, `--sage`, `--ink`…); las clases transversales (`btn-primary`, `form-input`, `subtab`, `empty-block`…) están en `base.css`. Usar esa paleta en lugar de colores nuevos.
