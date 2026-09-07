# rapidix-web

Aplicación Vue de Rapidix — **SPEC 02**.

Una sola SPA para todos los roles. Reemplaza al prototipo `rapidix_mockup (2).html`,
del que porta el diseño y el comportamiento, y consume la API de `rapidix-api`
(SPEC 01). El mockup se conserva intacto en la raíz del repositorio como
referencia de interfaz: no se enlaza ni se sirve desde ningún sitio.

**Vue 3** (`<script setup>`) · **TypeScript** · **Vite** · **Vue Router** ·
**Pinia** · **Vitest** · **Leaflet**

---

## Arranque local

Hace falta la API corriendo (ver `../rapidix-api/README.md`).

```bash
npm install
cp .env.example .env     # apunta VITE_API_URL a tu API local
npm run dev              # http://localhost:5173
```

La API solo acepta peticiones de los orígenes de su `CORS_ORIGIN`. Sin esa
variable asume desarrollo y permite `http://localhost:5173`, que es justo el
puerto que usa `npm run dev`.

### Scripts

| Script | Para qué |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con recarga en caliente. |
| `npm run build` | Comprueba tipos con `vue-tsc` y genera `dist/`. |
| `npm run preview` | Sirve el `dist/` con el preview de Vite. |
| `npm start` | Sirve el `dist/` con el servidor de producción (`server.mjs`). |
| `npm test` | Pruebas con Vitest, una pasada. |
| `npm run test:watch` | Pruebas en modo continuo. |

---

## Variables de entorno

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `VITE_API_URL` | sí | URL base de la API. Sin ella se asume `http://localhost:3000`. |
| `PORT` | no | Puerto del servidor de producción. Railway lo inyecta. |

Las variables `VITE_*` **se incrustan en el build**: cambiar `VITE_API_URL`
exige volver a compilar, no basta con reiniciar. No pongas secretos ahí.

---

## Cómo entrar

Dos modos, y el rol nunca lo elige quien entra:

- **Cliente** — teléfono → código de 6 dígitos → nombre si es un alta. El
  código se manda por WhatsApp; en desarrollo la API lo escribe en su consola.
- **Personal del negocio** — correo y contraseña. El rol viaja dentro del JWT.

Las cuatro tarjetas de staff del mockup (Administrador, Ruta, Operaciones,
Finanzas) se colapsan en una sola: la API exige credenciales y decide el rol.

Lo que ve cada rol sale de `GET /admin/menu`. **La interfaz no lleva su propia
copia de la matriz de permisos**: la pregunta, y el guard del router comprueba
que la sección de `meta.seccion` esté en el menú que devolvió la API.

---

## Estructura

```
src/
  api/          Capa HTTP sobre fetch, tipos del cable y endpoints de sesión
  assets/       tokens.css (colores, fuentes, radios) y base.css (clases transversales)
  components/   Barra inferior, drawer, toasts, skeletons, editor de recetas,
                mapa de dirección y subidor de imágenes
  layouts/      AppLayout: columna responsive, sin marco de teléfono
  router/       Mapa de rutas y guard de sesión y secciones
  stores/       auth · carrito · catálogo · recetario · destacados · ui
  utils/        Formato de dinero y fechas, reglas del constructor de segmentos
  views/        Pantallas de cliente
  views/admin/  Pantallas del panel de administración
```

### Decisiones que conviene conocer

- **El backend calcula, la interfaz pinta.** Ni un total, ni un envío, ni un
  recargo se calculan en el navegador: salen de `POST /carrito/previsualizar`,
  que comparte con `POST /pedidos` el mismo `calcularCarrito` del backend.
- **El carrito guarda solo `productoId` y `cantidad`** en `localStorage`, nunca
  precios: uno que sobreviva tres días no puede llevarlos congelados dentro.
- **Los errores tienen dos caminos.** Los del `ValidationPipe` se reparten bajo
  su campo con `ErrorApi.porCampo`; los de negocio se muestran como toast con
  el mensaje que dio la API, nunca uno inventado.
- **El Excel no se abre en el navegador.** El `.xlsx` se sube tal cual a
  `POST /admin/productos/importar`. No hay SheetJS.
- **Leaflet entra por npm**, no por CDN.
- Sin las variables `S3_*` en la API, la subida de imágenes avisa de que no
  está configurada y el formulario **se sigue guardando** con emoji.

---

## Pruebas

```bash
npm test
```

Cubren lo que no puede romperse en silencio:

- **`stores/carrito`** — cantidades, persistencia sin precios, descarte de
  respuestas fuera de orden, motivo del cupón rechazado, y que el carrito se
  vacíe solo tras el 201.
- **`utils/formato`** — dinero y fechas, incluidos los valores nulos e inválidos.
- **`api/http`** — el traductor de errores: `message` como cadena o como array,
  el reparto por campo y el cupón que viaja dentro del 423.
- **`router/guard`** — quién entra a cada sección, contra la matriz de roles.
- **`utils/segmentos`** — que `contiene` solo se ofrezca sobre Ciudad y Estado.

---

## Despliegue en Railway

Servicio estático aparte del de la API. `railway.json` ya está configurado:

- **Build:** `npm ci && npm run build`
- **Start:** `node server.mjs`

`server.mjs` sirve `dist/` y reescribe a `index.html` cualquier ruta que no sea
un fichero, para que recargar en `/admin/productos` no dé 404. Los assets
quedan fuera de esa reescritura: llevan hash en el nombre, así que uno que no
exista debe dar 404 y verse, no un `index.html` disfrazado de JavaScript.

Al desplegar hay que cerrar el círculo de las dos variables:

1. En **rapidix-web**: `VITE_API_URL` = dominio público de la API.
2. En **rapidix-api**: `CORS_ORIGIN` = dominio público de este servicio.

Si falta la segunda, la aplicación carga pero el navegador bloquea todas las
peticiones por CORS.

Recuerda que `VITE_API_URL` se incrusta en el build: cambiarla obliga a
redesplegar, no basta con reiniciar el servicio.

---

## Lo que no está aquí

Fuera de alcance del SPEC 02, por decisión explícita:

- Pantallas de negocio de Rutas, Operaciones y Finanzas. Sus endpoints
  devuelven 501 y la interfaz muestra el mensaje que da la API.
- PWA: manifest, service worker e instalación en pantalla de inicio.
- Pruebas end-to-end con Playwright.
- Internacionalización. La aplicación es solo en español.
- Ficha de detalle de un cliente en administración: se lista y se filtra.
- Gastar el saldo de cashback en un pedido. La API no lo implementa; aquí solo
  se muestran saldo, nivel y movimientos.
