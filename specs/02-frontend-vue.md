# SPEC 02 — Frontend Vue y conexión con la API

> **Estado:** Borrador
> **Depende de:** SPEC 01
> **Fecha:** 2026-09-07
> **Objetivo:** Construir la aplicación Vue que reemplaza al prototipo HTML y consume la API del SPEC 01, añadiendo al backend los tres endpoints que faltan para que ninguna pantalla se quede sin conectar.

---

## 1. Por qué existe este spec

El SPEC 01 dejó fuera de alcance, explícitamente, "conectar el mockup HTML a la API". Este spec es ese trabajo, pero no reescribiendo `rapidix_mockup (2).html`: construyendo una aplicación Vue nueva que porta su diseño y su comportamiento y habla con la API real.

El mockup sigue siendo la fuente de verdad de la interfaz: textos, orden de los campos, microcopy, jerarquía visual y flujos de pantalla. Se conserva intacto en la raíz del repositorio como referencia. El Word sigue siendo la fuente de verdad funcional. Cuando el mockup y la API se contradicen, manda la API: el mockup simulaba cosas que en producción no se sostienen.

Hay tres contradicciones de ese tipo y este spec las cierra:

1. **El login de staff.** El mockup entra como Administrador, Ruta, Operaciones o Finanzas eligiendo una tarjeta, sin credenciales. La API exige email y contraseña y el rol viaja dentro del JWT. Las cuatro tarjetas se colapsan en una, "Personal del negocio".
2. **El login de cliente.** El mockup pide teléfono y, si es nuevo, nombre. La API intercala un código OTP de 6 dígitos. Hace falta una pantalla que el mockup no tiene.
3. **Los totales del pedido.** El mockup los calcula en el navegador. La API los recalcula desde la base y su número es el que se cobra.

Además, al recorrer el mockup pantalla por pantalla contra los controladores de `rapidix-api` aparecen **tres huecos en el backend**. El SPEC 01 declaró el "Módulo Clientes" en su alcance (§2) pero no existe ningún `clientes.controller.ts`: la pantalla Perfil no puede guardar la dirección y la vista de administración Clientes no tiene de dónde leer. Y el carrito no tiene forma de mostrar el total antes de confirmar sin duplicar en JavaScript las reglas de envío, recargo y cashback. Este spec los cierra en el backend, no los rodea en el frontend.

---

## 2. Alcance

**Dentro:**

- Proyecto `rapidix-web`: Vue 3 (`<script setup>`) + TypeScript + Vite + Vue Router + Pinia + Vitest.
- Una sola SPA para todos los roles, gobernada por el menú que devuelve `GET /admin/menu`.
- Porte del diseño del mockup: sus tokens de color y tipografía y sus estilos, repartidos por componente. Sin marco de teléfono: pantalla completa en móvil, columna centrada con ancho máximo en escritorio.
- Capa HTTP propia sobre `fetch`, con `Authorization: Bearer`, mapeo de los errores de `ValidationPipe` y cierre de sesión automático ante 401.
- Login de cliente en tres pasos (teléfono → código de 6 dígitos → nombre si es alta) y login de personal por email y contraseña.
- App de cliente completa: Home, Tienda, Carrito, Recetario (4 pestañas), Cupones, Destacados y Perfil.
- Panel de administración completo: Productos con importación `.xlsx`, Recetas, Configuración (horario, parámetros, datos bancarios, noticias y avisos, niveles de fidelidad), el motor de Cupones entero (ciclo de vida, campañas con constructor de segmentos, fuentes y métricas), Clientes y Pedidos.
- Mapa Leaflet con marcador arrastrable en la dirección del perfil, para fijar `lat`/`lng`.
- Subida de imágenes por URL firmada de S3, con degradación explícita a emoji cuando la API responde 503.
- **Tres añadidos al backend `rapidix-api`**, sin los cuales quedarían pantallas muertas:
  - Módulo Clientes: `GET /perfil`, `PATCH /perfil` y `GET /admin/clientes`.
  - `POST /carrito/previsualizar`, que devuelve el desglose del carrito con la misma lógica que `POST /pedidos`.
  - CORS restringido por variable de entorno en lugar del `enableCors()` abierto de hoy.
- Pruebas con Vitest sobre stores y utilidades.
- Despliegue del build de Vite como servicio estático en Railway, junto a la API.

**Fuera de alcance (specs futuros):**

- Modificar `rapidix_mockup (2).html`. Se queda intacto en la raíz como referencia de interfaz. No se enlaza ni se sirve desde ningún sitio.
- Pantallas de negocio de Rutas, Operaciones y Finanzas. Sus endpoints devuelven 501 y la interfaz muestra el mensaje de "sección en definición" que ya devuelve la API. (SPEC 01 §2)
- PWA: manifest, service worker e instalación en pantalla de inicio.
- Pruebas end-to-end con Playwright.
- Internacionalización. La app es solo en español.
- Pantalla de detalle de un cliente en administración. Se lista y se filtra; abrir la ficha completa es otro spec.
- Todo lo que el SPEC 01 dejó fuera y sigue fuera: WhatsApp real, pagos, notificaciones push, generación de QR, referidos, CAC y auditoría.
- Gastar el saldo de cashback en un pedido. La API no lo implementa; la interfaz solo muestra saldo, nivel y movimientos.

---

## 3. Modelo de datos

La aplicación Vue no introduce entidades persistentes: la base de datos es la del SPEC 01 y no cambia. Lo que sí aparece son **tres contratos nuevos en el backend** y **el estado del cliente en Pinia**.

### 3.1 Contratos nuevos en `rapidix-api`

Ninguno necesita migración: `Cliente` ya tiene todos los campos.

```ts
// src/clientes/dto/perfil.dto.ts
export class ActualizarPerfilDto {
  nombre?: string;
  email?: string;
  fechaNacimiento?: string;   // ISO
  quienRecibe?: string;
  calle?: string;
  colonia?: string;
  cp?: string;
  ciudad?: string;
  estado?: string;
  referencias?: string;
  lat?: number;
  lng?: number;
  notificaciones?: boolean;
}

// Respuesta de GET /perfil y PATCH /perfil
export interface PerfilDto {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string;           // solo lectura: es la identidad de login
  fechaNacimiento: string | null;
  quienRecibe: string | null;
  direccion: {
    calle: string | null; colonia: string | null; cp: string | null;
    ciudad: string | null; estado: string | null; referencias: string | null;
    lat: number | null; lng: number | null;
  };
  notificaciones: boolean;
  pedidos: number;
  totalGastado: number;
  primerPedido: string | null;
  ultimoPedido: string | null;
  creado: string;
}
```

`telefono` nunca es editable: es la clave única de login por OTP. Cambiarlo es otro flujo, y no está en este spec.

```ts
// Respuesta de GET /admin/clientes — vista "Clientes" del panel
export interface ClienteAdminDto {
  id: string;
  nombre: string;
  telefono: string;
  ciudad: string | null;
  estado: string | null;
  pedidos: number;
  totalGastado: number;
  ultimoPedido: string | null;
  creado: string;
  fuenteCodigo: string | null;
  nivel: string | null;
}
```

Acepta `?q=` (busca en nombre y teléfono), `?orden=` (`ultimoPedido` por defecto, o `totalGastado`, `pedidos`, `creado`) y paginación `?pagina=&porPagina=`. Accesible para `ADMINISTRADOR` y `FINANZAS`, que son los roles que tienen `clientes` en `PERMISOS_POR_ROL`; el guard de sección existente ya lo resuelve.

```ts
// POST /carrito/previsualizar — mismo cuerpo que ValidarCuponDto pero con cupón opcional
export interface PrevisualizacionCarritoDto {
  items: Array<{
    productoId: string; nombre: string; unidad: string;
    precioUnitario: number; cantidad: number; importe: number;
    agotado: boolean;              // el producto se agotó después de meterlo al carrito
  }>;
  subtotal: number;
  envio: number;
  recargoFuera: number;
  descuento: number;
  total: number;
  cashbackEstimado: number;
  cupon: { codigo: string; descripcion: string } | null;
  dentroDeHorario: boolean;
  puedePedir: boolean;             // false si está fuera de horario y atenderFuera está apagado
  avisos: string[];                // "Estás fuera del horario de servicio…", "X ya no está disponible"
}
```

Se implementa extrayendo el cálculo que hoy vive dentro de `PedidosService.crear` a un método reutilizable. **`POST /pedidos` sigue siendo quien manda**: la previsualización es informativa y puede quedar obsoleta entre que se pinta y se confirma. Si al confirmar el total difiere, la API gana y la interfaz muestra el desglose que devolvió el pedido.

### 3.2 Estado del cliente (Pinia)

Cinco stores. Todo lo demás se pide a la API cuando se necesita y no se cachea.

```ts
// stores/auth.ts — lo único que se persiste junto al carrito
interface AuthState {
  token: string | null;            // localStorage: 'rapidix.token'
  usuario: { sub: string; rol: RolToken; nombre: string } | null;
  menu: ItemMenu[];                // de GET /admin/menu
  cargando: boolean;               // true mientras revalida con GET /auth/yo al arrancar
}

// stores/carrito.ts — localStorage: 'rapidix.carrito'
interface CarritoState {
  lineas: Array<{ productoId: string; cantidad: number }>;  // solo ids y cantidades
  codigoCupon: string | null;
  previsualizacion: PrevisualizacionCarritoDto | null;      // nunca se persiste
}

// stores/catalogo.ts   productos, categorías y el filtro de búsqueda de la tienda
// stores/recetario.ts  pestaña activa, filtro de categoría, búsqueda y receta en pausa
// stores/ui.ts         cola de toasts y estado del drawer de administración
```

El carrito guarda **solo `productoId` y `cantidad`**, nunca precios. Es la misma decisión que el SPEC 01 tomó en el backend ("el backend recalcula el carrito"), aplicada al almacenamiento local: un carrito que sobrevive tres días en `localStorage` no puede llevar precios congelados dentro.

### 3.3 Mapa de rutas

```
/login                      → selección de modo, OTP de cliente, credenciales de personal
/                           → Home            (cliente)
/tienda                     → Tienda          (cliente)
/carrito                    → Carrito         (cliente)
/recetario                  → Recetario       (cliente, pestañas por query ?tab=)
/recetario/:id              → Detalle de receta
/cupones                    → Mis Cupones     (cliente)
/destacados                 → Noticias y avisos
/perfil                     → Mi Perfil
/perfil/pedidos             → Mis Pedidos
/perfil/cashback            → Estado de cuenta de cashback
/admin                      → Menú del panel, según GET /admin/menu
/admin/productos            /admin/recetas          /admin/clientes      /admin/pedidos
/admin/configuracion        → submenú
  .../horario   .../parametros   .../bancarios   .../noticias   .../niveles
  .../cupones   → submenú: ciclo-vida · campanias · fuentes · metricas
/admin/rutas  /admin/operaciones  /admin/finanzas  → placeholder con el mensaje del 501
```

Cada ruta bajo `/admin` declara en su `meta.seccion` una de las nueve secciones de `PERMISOS_POR_ROL`. El guard del router comprueba que esa sección esté en el menú que devolvió la API; si no está, redirige. **La interfaz no lleva su propia copia de la matriz de permisos**: la pide. Un 403 del backend nunca debería llegar a verse, pero si llega, se muestra como toast y se vuelve al menú.

---

## 4. Plan de implementación

Cada paso deja el sistema arrancable y verificable.

**Backend primero** — son tres huecos pequeños y bloquean pantallas del frontend.

1. **Módulo Clientes en `rapidix-api`.** `src/clientes/` con `clientes.module.ts`, `clientes.controller.ts` (`GET /perfil`, `PATCH /perfil`), `admin-clientes.controller.ts` (`GET /admin/clientes`), `clientes.service.ts` y los DTO de §3.1. `GET/PATCH /perfil` exigen rol cliente; `/admin/clientes` usa el decorador de sección existente con `clientes`. Verificable en `/docs`.
2. **`POST /carrito/previsualizar`.** Extraer de `PedidosService.crear` el cálculo de subtotal, envío, recargo fuera de horario, descuento de cupón, total y cashback a un método `calcularCarrito` que ambos endpoints usan. El endpoint vive en el `CarritoController` que ya existe. Sin duplicar una sola regla.
3. **CORS por variable de entorno.** Sustituir `app.enableCors()` por un origen leído de `CORS_ORIGIN` (lista separada por comas; en desarrollo, `http://localhost:5173` por defecto). Documentar la variable en `.env.example` y en el README de la API.

**Andamiaje del frontend.**

4. **Crear `rapidix-web`.** Vite + Vue 3 + TypeScript. Instalar `vue-router`, `pinia`, `leaflet` y `vitest`. `.env.example` con `VITE_API_URL`. `npm run dev` levanta y `npm run build` produce `dist/`.
5. **Sistema de diseño.** Extraer del `<style>` del mockup los tokens (colores `--cream`, `--terracotta`, `--sage`, `--ink`, `--line`; fuentes de título y de texto; sombras; radios) a `src/assets/tokens.css`, y las clases transversales (`.btn-primary`, `.form-input`, `.form-label`, `.section-title`, `.switch`, `.modal-overlay`, `.modal-sheet`, `.pill-row`, `.subtab-row`) a `src/assets/base.css`. Lo específico de una pantalla se queda en el `<style scoped>` de su componente.
6. **Layout responsive.** `AppLayout.vue`: sin `.phone-shell`, sin notch, sin barra de estado simulada. Ancho completo en móvil; en escritorio, columna centrada de 430px sobre el fondo crema para la app de cliente, y ancho de hasta 900px para las vistas de administración con tablas.
7. **Capa HTTP.** `src/api/http.ts`: base `VITE_API_URL`, inyección del Bearer, `Content-Type` JSON, y un traductor de errores de Nest — `message` puede llegar como cadena o como array del `ValidationPipe`, y los errores de negocio de la API (`NOMBRE_REQUERIDO`, cupón inválido, fuera de horario) traen un `codigo` que la interfaz distingue de un fallo genérico. Un 401 limpia la sesión y manda a `/login`.
8. **Toasts y skeletons.** `ui` store con cola de toasts, `<ToastHost>` en el layout y `<SkeletonList>` / `<SkeletonCard>` con la silueta de tarjeta de producto y de receta.

**Autenticación.**

9. **Store de auth y arranque.** Token en `localStorage`, `GET /auth/yo` al montar la app para revalidarlo, `GET /admin/menu` tras autenticar. Mientras revalida, pantalla de carga; si falla, login.
10. **Pantallas de login.** Paso 1: dos tarjetas, "Cliente" y "Personal del negocio". Cliente: teléfono → `POST /auth/cliente/solicitar-codigo` → campo de 6 dígitos → `POST /auth/cliente/verificar-codigo`; si la API responde `NOMBRE_REQUERIDO`, se pide el nombre y **se reenvía el mismo código**, que la API deja vivo a propósito. Si el enlace de entrada trae `?r=CODIGO` o se llegó por `/r/CODIGO`, se guarda y se manda como `fuenteCodigo` en el alta. Personal: email y contraseña contra `POST /auth/staff/login`.
11. **Guard del router.** Rutas de cliente, rutas de administración por `meta.seccion` y ruta pública de login.

**App de cliente.**

12. **Shell.** Barra inferior con Home, Tienda, Recetario, Cupones (solo rol cliente) y Destacados con su insignia de no leídos; barra superior con el título de la pantalla y el botón de menú que abre el drawer de administración construido con `GET /admin/menu`. Un cliente ve ahí solo "Mis Pedidos", que es lo que le da la matriz.
13. **Home.** Saludo con el nombre del token, banner de receta en pausa desde `GET /recetario/pausada`, las tres categorías que llevan al Recetario ya filtrado, y la tira de promociones desde `GET /destacados`.
14. **Tienda.** `GET /productos` y `GET /categorias`, buscador, agrupación por categoría, tarjeta de producto con control de cantidad, barra de carrito flotante. Un producto agotado sale marcado y ofrece "Programar" (`POST /productos/:id/programar`).
15. **Carrito y pedido.** Desglose desde `POST /carrito/previsualizar` recalculado en cada cambio, campo de cupón contra `POST /carrito/validar-cupon`, aviso de fuera de horario con su recargo, y confirmación con `POST /pedidos`. Pantalla de éxito con folio, total y cashback generado; el carrito se vacía solo tras el 201.
16. **Recetario.** `GET /recetas` con las cuatro pestañas (Recetario, Mis Recetas, Comunidad, Historial), buscador por nombre e ingrediente con sugerencias, y filtro por desayuno/comida/cena. Detalle con ingredientes, pasos, vídeo de YouTube incrustado, guardar (`POST`/`DELETE /recetas/:id/guardar`), pausar (`PUT /recetas/:id/pausar`), "¡Listo a comer!" (`POST /recetas/:id/cocinada`) y calificación. **El bloqueo por inactividad se maneja aquí**: si `GET /recetas/:id` responde con el error de bloqueo, se muestra la pantalla de recetario bloqueado con el cupón INACTIVITY que la API emitió, no un toast de error.
17. **Mis recetas.** Modal de creación y edición con ingredientes y pasos dinámicos, imagen, categorías y switch de compartir con la comunidad, contra `POST /recetas`, `PATCH /recetas/:id` y `PATCH /recetas/:id/compartir`.
18. **Cupones.** `GET /cupones`, tarjeta por cupón con código, descuento, compra mínima, vigencia y estado, y copiado al portapapeles.
19. **Destacados.** `GET /destacados` con noticias y avisos, y `POST /destacados/leido` al entrar, que apaga la insignia.
20. **Perfil.** `GET /perfil` y `PATCH /perfil`. Datos personales, quién recibe, dirección con mapa Leaflet de marcador arrastrable y botón de ubicación actual, switch de notificaciones, tarjeta de cashback (`GET /perfil/cashback`) con nivel y progreso, estado de cuenta (`GET /perfil/cashback/movimientos`), Mis Pedidos (`GET /pedidos/mios`) y cerrar sesión.

**Panel de administración.**

21. **Productos.** Listado desde `GET /admin/productos`, alta y edición, switch de agotado, borrado con confirmación, importación `.xlsx` subiendo el archivo a `POST /admin/productos/importar` — **el navegador no procesa el Excel; SheetJS desaparece** — y descarga de la plantilla.
22. **Recetas.** `GET`/`POST /admin/recetas` y `PATCH /admin/recetas/:id`, con el mismo editor de ingredientes y pasos que el del cliente, reutilizando el componente.
23. **Configuración.** Submenú y las cinco pantallas: horario de servicio con días y horas y switch de atender fuera de horario; parámetros del negocio; datos bancarios con botón de copiar; noticias y avisos con alta y borrado; niveles de fidelidad (`/admin/configuracion/niveles`) con su CRUD, avisando de que los umbrales del seed son provisionales.
24. **Cupones — ciclo de vida.** Los cinco tipos con sus contadores en vivo, switch de activo, edición de parámetros y "emitir de prueba".
25. **Cupones — campañas.** CRUD completo con el constructor de segmentos: los siete atributos (`pedidos`, `totalGastado`, `diasSinComprar`, `diasComoCliente`, `ciudad`, `estado`, `mesCumpleanos`), los seis operadores y la restricción de que `contiene` solo se ofrece sobre `ciudad` y `estado`. El selector de audiencia muestra `REFERRAL` deshabilitado y explicado, porque está en el enum pero nunca califica. `SOURCE` obliga a elegir una fuente. Restricción por categorías desde `GET /categorias`.
26. **Cupones — fuentes y métricas.** CRUD de fuentes con su enlace `rapidix.mx/r/CODIGO` copiable, y el panel de métricas de `GET /admin/cupones/metricas` con generados, utilizados y porcentaje de utilización.
27. **Clientes y Pedidos.** `GET /admin/clientes` con buscador, orden y paginación; `GET /admin/pedidos` con folio, cliente, total y estado.
28. **Rutas, Operaciones y Finanzas.** Una vista de placeholder compartida que llama al endpoint, recibe el 501 y muestra su mensaje con el estilo `.admin-placeholder` del mockup. Nada de inventar interfaz para lo que no está definido.

**Cierre.**

29. **Subida de imágenes.** Componente `<SubidorImagen>`: pide `POST /uploads/firma`, sube con `PUT` a la URL firmada y devuelve la URL pública. Si la firma responde 503, muestra "La subida de imágenes no está configurada" y el formulario sigue guardándose con emoji.
30. **Pruebas.** Vitest sobre el store de carrito, el formateo de dinero y fechas, el traductor de errores de la API, el guard de secciones y las reglas del constructor de segmentos.
31. **Despliegue.** Servicio estático en Railway que sirve `dist/` con reescritura a `index.html` para las rutas del SPA, `VITE_API_URL` apuntando a la API y `CORS_ORIGIN` de la API apuntando al dominio del frontend. `README.md` de `rapidix-web` con arranque local, variables y despliegue.

---

## 5. Criterios de aceptación

**Backend añadido**

- [ ] `GET /perfil` con token de cliente devuelve sus datos y su dirección; con token de staff devuelve 403.
- [ ] `PATCH /perfil` guarda calle, colonia, CP, ciudad, estado, referencias, `lat` y `lng`, y un `GET` posterior los devuelve.
- [ ] `PATCH /perfil` con un campo `telefono` en el cuerpo devuelve 400 por `forbidNonWhitelisted`.
- [ ] `GET /admin/clientes` responde 200 para `ADMINISTRADOR` y `FINANZAS`, y 403 para `RUTA` y `OPERACIONES`.
- [ ] `POST /carrito/previsualizar` con los mismos ítems que un `POST /pedidos` posterior devuelve idéntico `subtotal`, `envio`, `recargoFuera`, `descuento` y `total`.
- [ ] Con `CORS_ORIGIN` apuntando a otro dominio, una petición desde el frontend local es rechazada por el navegador.

**Sesión**

- [ ] Un cliente nuevo entra con teléfono, recibe el código por consola, lo introduce, la API pide el nombre, lo escribe **sin pedir un código nuevo** y queda dentro.
- [ ] Recargar la página con sesión abierta deja al usuario donde estaba, sin volver al login.
- [ ] Borrar el token de `localStorage` y hacer cualquier acción manda al login con un aviso, no a una pantalla en blanco.
- [ ] Un usuario con rol `RUTA` que escribe `/admin/productos` en la barra de direcciones acaba en el menú, no en la pantalla de productos.
- [ ] El menú lateral de un cliente muestra solo "Mis Pedidos"; el de un administrador, las ocho secciones de su fila en `PERMISOS_POR_ROL`.

**Pedido de punta a punta**

- [ ] Añadir tres productos, aplicar un cupón válido y confirmar crea un pedido con folio `ORD-` y el carrito queda vacío.
- [ ] El total que muestra el carrito antes de confirmar coincide, al céntimo, con el del pedido creado.
- [ ] Un cupón vencido o que no alcanza la compra mínima muestra el motivo que da la API en el campo del cupón, no un toast genérico.
- [ ] Fuera del horario de servicio con `atenderFuera` activo, el carrito muestra el recargo como línea propia; con `atenderFuera` apagado, el botón de confirmar está deshabilitado y explica por qué.
- [ ] Cerrar el navegador y volver conserva el carrito; si entre medias subió el precio de un producto, el total mostrado es el nuevo.

**Recetario**

- [ ] Buscar "pollo" devuelve recetas cuyo nombre o alguno de cuyos ingredientes lo contiene.
- [ ] Pausar una receta la muestra en el banner del Home; pausar otra sustituye a la primera, nunca coexisten dos.
- [ ] Con el Recetario bloqueado por inactividad, abrir una receta muestra la pantalla de bloqueo con el cupón INACTIVITY, y la lista de recetas se sigue viendo.
- [ ] Crear una receta propia con tres ingredientes y cuatro pasos la deja en "Mis Recetas"; activar compartir la hace aparecer en Comunidad.

**Administración**

- [ ] Subir el `.xlsx` de la plantilla da de alta los productos y muestra el resumen de la importación con las filas rechazadas y su motivo.
- [ ] No queda ninguna referencia a SheetJS ni a Leaflet por CDN: ambas cosas o son dependencias de npm o no están.
- [ ] Marcar un producto como agotado hace que en la Tienda aparezca marcado y con el botón "Programar".
- [ ] Crear una campaña con la regla `totalGastado > 1000` y emitirla de prueba genera cupón solo para clientes que la cumplen.
- [ ] El operador `contiene` no se ofrece para `pedidos`, `totalGastado`, `diasSinComprar`, `diasComoCliente` ni `mesCumpleanos`.
- [ ] La audiencia `REFERRAL` aparece deshabilitada con la explicación de que el programa de referidos no está implementado.
- [ ] Las métricas de cupones muestran los mismos números que `GET /admin/cupones/metricas` devuelve por Swagger.
- [ ] Entrar como `RUTA` y abrir Rutas muestra el mensaje del 501, no un error ni una pantalla vacía.

**Interfaz**

- [ ] Todas las listas muestran skeleton mientras cargan; ninguna pantalla salta de vacía a llena sin estado intermedio.
- [ ] Un error de validación de la API se pinta bajo su campo; un error de acción se muestra como toast con el mensaje de la API.
- [ ] En un móvil de 390px de ancho no hay desbordamiento horizontal en ninguna pantalla.
- [ ] En escritorio la app de cliente se ve como columna centrada sobre el fondo crema, sin marco de teléfono.
- [ ] Con las variables `S3_*` sin configurar, crear una receta con imagen avisa de que la subida no está disponible y guarda igual.

**Cierre**

- [ ] `npm run test` pasa; `npm run build` genera `dist/` sin errores de TypeScript.
- [ ] `rapidix_mockup (2).html` sigue en la raíz, sin modificar.
- [ ] El frontend desplegado en Railway carga, autentica contra la API desplegada y permite completar un pedido.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** una sola SPA para todos los roles, como el mockup. La matriz de permisos ya está en el backend y `GET /admin/menu` la sirve; separar en dos aplicaciones duplicaría autenticación, cliente HTTP y sistema de diseño para ahorrar unos kilobytes de bundle a un panel que usan cinco personas.
- **No:** dos aplicaciones, `rapidix-web` y `rapidix-admin`. Se revisará si el panel de administración crece hasta justificar su propio despliegue.
- **Sí:** Vue 3 con `<script setup>` y TypeScript sobre Vite. Petición explícita del usuario.
- **Sí:** portar el CSS del mockup casi literalmente, extrayendo tokens y clases transversales. El diseño está validado con el cliente; retraducirlo a utilidades es reinterpretarlo, y cada reinterpretación es una oportunidad de que se pierda un detalle aprobado.
- **No:** Tailwind. **No:** PrimeVue, Vuetify ni ninguna librería de componentes: impondrían su propio lenguaje visual sobre un diseño ya cerrado.
- **Sí:** eliminar el marco de teléfono. Era un recurso de presentación del mockup; en un móvil real es una app dentro del dibujo de un móvil.
- **Sí:** Pinia con servicios `fetch` escritos a mano y tipos declarados a mano. Sin paso de generación, sin dependencia de que el backend esté levantado para compilar.
- **No:** cliente generado desde el OpenAPI. Ata el build del frontend a la disponibilidad de la API y añade un paso de sincronización a un equipo pequeño. Se reconsiderará si los tipos empiezan a desincronizarse.
- **No:** TanStack Query. Una capa conceptual más de la que esta aplicación no necesita hoy: la mayoría de las pantallas cargan una vez y refrescan tras una mutación.
- **Sí:** añadir el módulo Clientes al backend en este spec. El SPEC 01 lo declaró en su alcance §2 y no llegó a construirse; sin él, Perfil y la vista Clientes serían pantallas de mentira. Es un servicio pequeño sobre un modelo que ya existe y no necesita migración.
- **Sí:** añadir `POST /carrito/previsualizar`. La alternativa era reimplementar en TypeScript del navegador el envío, el recargo fuera de horario y el mínimo de cashback, es decir, tener la regla del dinero en dos idiomas. El SPEC 01 ya decidió que "el backend recalcula el carrito"; esto es la consecuencia de esa decisión, no una excepción.
- **Sí:** el desglose devuelto por `POST /pedidos` gana sobre el de la previsualización si difieren. La previsualización se pinta y el mundo puede cambiar antes de confirmar.
- **Sí:** el carrito persiste en `localStorage` solo con `productoId` y `cantidad`. Un carrito de tres días con precios dentro es un carrito que miente.
- **Sí:** JWT en `localStorage` y revalidación con `GET /auth/yo` al arrancar. La vigencia del token es de 7 días y la app es de pedidos en móvil: obligar a un OTP por sesión de navegador la haría inusable. **No:** `sessionStorage`; **no:** solo memoria.
- **Sí:** colapsar las cuatro tarjetas de staff del mockup en una sola de "Personal del negocio". El rol viaja en el JWT: dejar elegir "Finanzas" en el login y luego mostrar el menú de Ruta sería una interfaz que miente sobre lo que hace.
- **Sí:** una pantalla de código OTP que el mockup no tiene. Es la consecuencia de que el SPEC 01 decidiera autenticación real; el paso de nombre se mantiene exactamente donde la API lo pide, reenviando el mismo código.
- **Sí:** el guard del router consulta el menú devuelto por la API en vez de llevar su propia copia de `rolePermissions`. Dos copias de una matriz de permisos acaban discrepando, y la copia del navegador es la que un usuario puede editar.
- **Sí:** Leaflet con OpenStreetMap, instalado desde npm. Es lo que ya usa el mockup, no necesita clave ni facturación, y `lat`/`lng` son datos que Rutas va a necesitar. **No:** Google Maps, que exigiría clave, facturación y restricción de dominio para una funcionalidad ya resuelta.
- **Sí:** el `.xlsx` se sube tal cual y lo procesa el backend, que ya tiene `exceljs` y la validación de columnas del Word §6.6. SheetJS desaparece del frontend.
- **Sí:** todo el panel de administración en este spec, incluido el motor de cupones completo. Decisión explícita del usuario tras plantearle dividirlo: el alcance es "conectar todo".
- **Sí:** una vista de placeholder para Rutas, Operaciones y Finanzas que muestra el mensaje del 501 que devuelve la API. Inventarles interfaz antes de su ronda de definición funcional sería trabajo a tirar.
- **Sí:** la app sigue siendo utilizable sin S3 configurado, guardando con emoji. Es lo que ya hacen los datos del seed, y bloquear el alta de productos por una variable de entorno que falta es un fallo de arranque disfrazado de validación.
- **No:** respaldo a base64 cuando no hay S3. Reintroduciría exactamente lo que el SPEC 01 descartó por degradar los listados.
- **Sí:** Vitest sobre stores y utilidades. Se prueba lo que tiene lógica: carrito, permisos, formateo, traducción de errores, reglas de segmento. Los componentes de presentación cambian de forma constante y probarlos por captura solo genera ruido.
- **No:** Playwright en este spec. Exige base sembrada y un OTP de prueba, que es un agujero de seguridad si se cuela en producción. Va en su propio spec, junto a la decisión de cómo se autentica un test.
- **No:** PWA. Un service worker mal invalidado sirve versiones viejas y convierte cada despliegue en una investigación. Cuando haya notificaciones push que lo justifiquen, tendrá su spec.
- **Sí:** `rapidix_mockup (2).html` se queda intacto en la raíz. Sigue siendo la referencia de microcopy y de detalles de interfaz, y el SPEC 01 lo cita por esa ruta.
- **Sí:** despliegue en Railway junto a la API. Un solo proveedor, un solo panel, y CORS se resuelve con una variable en vez de con una lista de dominios externos.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| El alcance es grande: la app de cliente entera más nueve secciones de administración, incluido el motor de cupones. Se puede quedar a medias. | El plan está ordenado para que el corte sea utilizable: tras el paso 20 la app de cliente funciona completa contra la API, y la administración se sigue haciendo por Swagger. Los pasos 21 a 28 son incrementos independientes entre sí. |
| Portar 870 líneas de CSS pensadas para un documento único a componentes puede degradar el diseño validado sin que nadie lo note. | Los tokens y las clases transversales se extraen tal cual a dos archivos globales y solo lo específico de pantalla se scopea. La comparación contra el mockup abierto al lado es parte de la verificación de cada pantalla. |
| La previsualización del carrito y `POST /pedidos` pueden divergir si alguien toca una y no la otra. | Se extrae un único `calcularCarrito` que ambos endpoints llaman. El criterio de aceptación compara los dos desgloses al céntimo, y es la prueba que hay que repetir ante cualquier cambio de reglas de precio. |
| Los importes viajan como `number` en JSON y en JavaScript `0.1 + 0.2` no da `0.3`. Sumar en el navegador reintroduce el problema que el backend evita con `Prisma.Decimal`. | El frontend **nunca suma dinero**: muestra los importes que devuelve la API y los formatea. Cualquier total que aparezca en pantalla viene de una respuesta, no de un cálculo local. |
| El OTP se entrega por consola del servidor. En desarrollo compartido, cualquiera con acceso al log entra como cualquier cliente. | Ya está mitigado en el SPEC 01: en producción la implementación de consola no se registra y el arranque falla sin un proveedor real. La pantalla de código no muestra nunca el código, ni siquiera en desarrollo. |
| El token en `localStorage` es accesible desde JavaScript y por tanto vulnerable a XSS. | Vue escapa por defecto y en este proyecto no se usa `v-html` con contenido de la API en ningún punto. La alternativa, cookie `HttpOnly`, exige cambiar el esquema de autenticación del backend y queda para un spec de endurecimiento. |
| El bloqueo del Recetario por inactividad llega como error de la API. Si se trata como un fallo genérico, el cliente ve un toast rojo en vez de su cupón. | El traductor de errores distingue por `codigo`, no por estado HTTP, y el bloqueo tiene su propia pantalla. Es un criterio de aceptación explícito. |
| El constructor de segmentos es la interfaz más compleja del panel y sus reglas mal formadas pueden emitir cupones a quien no toca. | Los atributos, operadores y la restricción de `contiene` se toman literalmente de `ATRIBUTOS_SEGMENTO`, `OPERADORES_SEGMENTO` y `ATRIBUTOS_TEXTO`. La emisión de prueba permite ver a quién califica antes de activar la campaña. |
| Los tipos del frontend se escriben a mano y pueden desincronizarse del backend en silencio. | Viven todos en `src/api/tipos.ts`, ordenados por dominio y citando el DTO del que salen. Si aparece la segunda desincronización, se reabre la decisión de generar desde el OpenAPI. |
| `GET /admin/clientes` sin límite se traga la tabla entera cuando la base crezca. | Nace paginado, con 50 por página por defecto, y ordenado por `ultimoPedido`. |

---

## Lo que **no** está en este spec

- Modificar `rapidix_mockup (2).html`.
- Pantallas de negocio de Rutas, Operaciones y Finanzas.
- Ficha de detalle de un cliente en administración.
- PWA: manifest, service worker e instalación.
- Pruebas end-to-end.
- Internacionalización.
- Gastar el saldo de cashback en un pedido.
- Todo lo que el SPEC 01 dejó fuera y sigue fuera: WhatsApp Business API real, pagos, notificaciones push, generación de QR, programa de referidos, CAC por canal y auditoría de cambios administrativos.

Cada uno de esos, si entra, va en su propio spec.
