# SPEC 03 — Inventario en ruta y liquidación de la entrega

> **Estado:** Aprovado
> **Depende de:** SPEC 01, SPEC 02
> **Fecha:** 2026-10-01
> **Objetivo:** Hacer que la mercancía salga del inventario real al recolectarse y viva en «en ruta» hasta entregarse o regresar, y que la liquidación de la entrega no se pueda finalizar con productos sin contar o con faltante sin cobrar.

---

## 1. Por qué existe este spec

Hoy un producto tiene tres saldos: `inventario` (real), `aptInventario` (ATP) e `inventarioEnRuta`. El tercero es solo informativo: el real no baja al recolectar sino al entregar, así que lo que va en un camión sigue contando como si estuviera en el estante. Quien mira Inventario no puede saber cuánto hay de verdad en bodega.

Este spec cambia esa regla. Las piezas pasan de un saldo a otro y siempre están en uno solo:

| Momento | Real | ATP | En ruta |
| --- | --- | --- | --- |
| Se guarda el pedido | — | baja | — |
| Se recolecta | baja | — | sube |
| Se quita de la entrega antes de salir | sube | — | baja |
| Se entrega (lo que el cliente acepta) | — | — | baja |
| Corte: lo rechazado de un pedido entregado | sube | sube | baja |
| Corte: pedido no entregado que regresa entero | sube | — | baja |
| Corte: lo cobrado como faltante | — | — | baja |

La liquidación ya tiene la tabla del camión y el botón «Generar pedido x faltante», pero hoy «Devuelto» es una ayuda de pantalla: no viaja a la API y no impide cerrar. Con el real moviéndose al recolectar, un conteo sin cuadrar deja el inventario mal, así que pasa a ser obligatorio.

**Punto de partida.** El saldo `Producto.inventarioEnRuta`, `InventarioService.subirARuta()` / `bajarDeRuta()` y la columna «En ruta» de Productos → Inventario ya están escritos (migración `20261001120000_inventario_en_ruta`). Este spec los da por hechos y commiteados antes de empezar.

Lo que pasa después de «Finalizar liquidación» —aceptar el dinero, aceptar la devolución, Ingresos, CXC— es del SPEC 04.

---

## 2. Alcance

**Dentro:**

- Recolectar saca del inventario real lo que el pedido tenía apartado y deja su renglón en la bitácora con el motivo nuevo `RUTA`.
- Quitar un pedido de la entrega antes de salir devuelve al real lo que sacó.
- Entregar un pedido recolectado ya no mueve el real: solo baja «en ruta». La entrega en tienda sigue sacando del real con `ENTREGA`, como hoy.
- El corte devuelve al real todo lo que baja del camión, y además libera a ATP lo que un cliente rechazó de un pedido entregado.
- El pedido por faltante deja de descontar el real (esas piezas ya salieron al recolectar) y toma su precio de las listas de precios según la cantidad.
- «Finalizar liquidación» exige «Devuelto» capturado en cada producto con devolución y «Faltante» en cero; la API lo valida.
- La columna «Cargado» de la tabla del camión pasa a llamarse «Recolectado».
- El corte recién cerrado se muestra como «Liquidado» en Rutas → Historial.
- Motivo `RUTA` visible y filtrable en Productos → Movimientos; no se puede capturar a mano.
- Actualizar `rapidix-api/ESTRUCTURA.md`, los comentarios de `schema.prisma` y la nota al pie de `TabInventario.vue`.

**Fuera de alcance (specs futuros):**

- «Aceptar dinero», «Aceptar devolución» y «Entrega aceptada» en Finanzas → Cortes de ruta (SPEC 04). Hasta entonces el corte del repartidor sigue descargando el camión.
- Los estatus Liquidado → Aceptado → Cerrado en la base y la pestaña Ingresos (SPEC 04).
- Rechazar una devolución y reanudar la entrega (SPEC 04).
- Cuentas por cobrar y la pestaña CXC (SPEC 04).
- Desglose de «en ruta» por repartidor, entrega o pedido. La columna es un total por producto.
- Cambios al arqueo de efectivo: que el dinero no cuadre sigue sin bloquear el cierre.

---

## 3. Modelo de datos

No hay tablas ni columnas nuevas. Cambia un enum y un cuerpo de petición.

### 3.1 `MotivoMovimiento`

```prisma
enum MotivoMovimiento {
  COMPRA
  VENTA
  MERMA
  TRASPASO
  AJUSTE
  DEVOLUCION
  /// Entrega en tienda: el cliente se lo lleva sin pasar por un camion.
  ENTREGA
  /// La mercancia sube a un camion (SALIDA) o baja de el (ENTRADA). Solo
  /// mueve el fisico: lo que esta arriba lo cuenta `inventarioEnRuta`.
  RUTA
}
```

Migración `rapidix-api/prisma/migrations/20261001130000_motivo_ruta/migration.sql`: un solo `ALTER TYPE "MotivoMovimiento" ADD VALUE 'RUTA'`. No hay `UPDATE` de siembra (ver Decisiones).

### 3.2 Movimientos que escribe cada paso

Todos con `afecta = FISICO` y `pedidoId`, y solo con `controlInventario` encendido. `inventarioEnRuta` se mueve siempre, con el interruptor encendido o apagado.

| Paso | Tipo | Motivo | Cantidad |
| --- | --- | --- | --- |
| Recolectar | SALIDA | RUTA | Lo apartado con `VENTA` de solo APT que aún no ha salido con `RUTA` ni con `ENTREGA`. |
| Quitar de la entrega | ENTRADA | RUTA | Lo que el pedido tiene fuera por `RUTA` (salidas menos entradas). |
| Corte: baja del camión | ENTRADA | RUTA | `cargada − entregada` del renglón, menos lo cobrado como faltante, con tope en lo que el pedido tiene fuera por `RUTA`. |

Lo rechazado de un pedido entregado conserva además su movimiento de hoy: `ENTRADA`, `DEVOLUCION`, `APT` (`devolverDeRuta()`), que es el que lo libera para venta.

Las cantidades se deducen de los movimientos ya escritos del pedido, no de sus líneas, igual que `salidasAlEntregar()` y `devolucionesDeRuta()`.

### 3.3 Cuerpo de `POST /admin/rutas/entregas/:id/corte`

```ts
class CerrarCorteDto {
  montoDeclarado: number;
  notas?: string;
  /** Lo que el repartidor conto al bajar del camion, por producto. */
  devueltos: { productoId: string; cantidad: number }[];
}
```

- `cantidad` es un entero mayor o igual que cero.
- Una entrega sin nada que regrese manda `devueltos: []`.
- Si algún producto con `devolucion > 0` del conteo no viene, o viene con otra cantidad, la API responde 409 con `code: 'CONTEO_NO_CUADRA'` y no cierra nada.

### 3.4 Precio del pedido por faltante

`precioUnitario(producto, cantidad)` de `rapidix-api/src/catalogo/precios.ts`, con la cantidad faltante de ese producto. Deja de usarse `precioVenta` a secas.

---

## 4. Plan de implementación

**Inventario (API).**

1. Añadir `RUTA` a `MotivoMovimiento` en `prisma/schema.prisma`, escribir la migración `20261001130000_motivo_ruta` y correr `npx prisma generate`. `InventarioService.registrarLote()` rechaza `RUTA` capturado a mano, como ya rechaza `VENTA` y `ENTREGA`.
2. En `src/inventario/salidas-del-pedido.ts`: nueva función pura `salidasARuta()` (lo apartado que aún no sale), nueva `regresosDeRuta()` (lo que vuelve al físico, con tope en lo que salió por `RUTA`), y `salidasAlEntregar()` descuenta también lo salido por `RUTA`. Pruebas en `salidas-del-pedido.spec.ts`.
3. En `InventarioService`: `registrarSalidaARuta()` y `registrarRegresoDeRuta()`, que leen los movimientos del pedido, preguntan a las funciones puras y aplican por `aplicar()`.
4. `RutasService.recolectar()` llama a `registrarSalidaARuta()` junto a `subirARuta()`. Si el físico no alcanza, la recolección se rechaza con el error de saldo insuficiente de `aplicar()` y no cambia nada.
5. `RutasService.quitarDeEntrega()` llama a `registrarRegresoDeRuta()` antes de borrar los renglones de carga.
6. `RutasService.entregar()` no cambia de forma: `registrarEntrega()` ya no saca nada de un pedido recolectado porque `salidasAlEntregar()` lo da por salido. Actualizar su comentario.
7. `planDeDescarga()` en `src/rutas/alcance-del-corte.ts` añade a cada pedido las líneas que vuelven al físico, descontando los faltantes primero de los pedidos entregados y luego de los que regresan enteros. `CortesService.descargarCamion()` llama a `registrarRegresoDeRuta()` con ellas. Pruebas en `alcance-del-corte.spec.ts`.
8. `CortesService.generarFaltante()` deja de llamar a `registrarFaltanteDeRuta()`, que se borra de `InventarioService`.

**Liquidación (API).**

9. `generarFaltante()` toma el precio con `precioUnitario()` de `catalogo/precios.ts`.
10. Función pura `conteoQueNoCuadra(conteo, devueltos)` en `src/rutas/liquidacion-de-ruta.ts`, con pruebas en `liquidacion-de-ruta.spec.ts`.
11. `CerrarCorteDto` recibe `devueltos`; `CortesService.cerrar()` valida con `conteoQueNoCuadra()` dentro de la transacción, después de `calcular()`, y lanza `CONTEO_NO_CUADRA`. `corregirDeclarado()` usa un DTO propio sin `devueltos`.

**Frontend.**

12. `src/api/tipos.ts`: `'RUTA'` en `MotivoMovimiento`. `views/admin/productos/etiquetas.ts`: etiqueta «Ruta». El filtro de motivos de `TabMovimientos.vue` lo ofrece.
13. `views/admin/rutas/liquidacion.ts`: función pura `conteoCompleto(conteo, contados)`, con pruebas en `liquidacion.spec.ts`. `estadoEnHistorial()` devuelve «Liquidado» para el corte `CERRADO`.
14. `LiquidacionEntregaView.vue`: `puedeCerrar` exige `conteoCompleto`; el cierre manda `devueltos`; un aviso junto al botón dice qué falta por contar o cobrar; el modal del faltante dice «al precio de lista que corresponde a la cantidad».
15. `TablaConteo.vue`: el encabezado «Cargado» pasa a «Recolectado».
16. `TabInventario.vue`: la nota al pie dice que lo que va en ruta ya no cuenta en el físico.

**Cierre.**

17. Actualizar `rapidix-api/ESTRUCTURA.md` (saldos de `Producto`, `InventarioService`, `salidas-del-pedido.ts`, el corte) y el comentario de `inventarioEnRuta` en `schema.prisma`.

---

## 5. Criterios de aceptación

Todos con `controlInventario` encendido salvo donde se indica. El producto de ejemplo arranca en real 10, ATP 10, en ruta 0.

**Saldos**

- [ ] Guardar un pedido de 4 piezas deja 10 / 6 / 0.
- [ ] Recolectarlo deja 6 / 6 / 4 y escribe un movimiento `SALIDA` · `RUTA` · `FISICO` de 4 con su `pedidoId`.
- [ ] Quitarlo de la entrega antes de salir deja 10 / 6 / 0 y escribe una `ENTRADA` · `RUTA` · `FISICO` de 4.
- [ ] Entregarlo completo deja 6 / 6 / 0 y no escribe ningún movimiento `ENTREGA`.
- [ ] Entregarlo aceptando 3 deja 6 / 6 / 1; al finalizar la liquidación con «Devuelto» 1 queda 7 / 7 / 0.
- [ ] Un pedido recolectado y no entregado deja, tras la liquidación con «Devuelto» 4, 10 / 6 / 0 y el pedido en «Listo para entrega».
- [ ] Con el cliente aceptando 3, «Devuelto» 0 y el pedido por faltante generado por 1, la liquidación deja 6 / 6 / 0.
- [ ] Generar el pedido por faltante no escribe ningún movimiento de inventario.
- [ ] Entregar un pedido de recogida en tienda sigue escribiendo `SALIDA` · `ENTREGA` · `FISICO`.
- [ ] Recolectar un pedido cuyo físico no alcanza responde con error y no cambia ni el pedido ni ningún saldo.
- [ ] Con `controlInventario` apagado, recolectar 4 deja real y ATP sin cambio y en ruta en 4; la liquidación lo regresa a 0 sin escribir movimientos.
- [ ] Un pedido recolectado antes de este cambio (sin movimiento `RUTA`) saca su físico al entregarse con `ENTREGA` y no suma al físico en el corte.
- [ ] `POST /admin/inventario/movimientos` con motivo `RUTA` responde 400.

**Liquidación**

- [ ] La tabla del camión muestra las columnas Recolectado, Entregado, Devolución, Devuelto y Faltante, en ese orden.
- [ ] Con un producto con devolución sin capturar en «Devuelto», «Finalizar liquidación» está deshabilitado.
- [ ] Con un «Faltante» mayor que cero, «Finalizar liquidación» está deshabilitado y «Generar pedido x faltante» habilitado.
- [ ] Tras generar el pedido por faltante, la «Devolución» del producto baja a lo contado, «Faltante» queda en 0 y el botón de finalizar se habilita.
- [ ] `POST /admin/rutas/entregas/:id/corte` sin `devueltos`, o con una cantidad distinta de la devolución, responde 409 `CONTEO_NO_CUADRA` y la entrega sigue sin corte.
- [ ] Declarar menos efectivo del calculado sigue permitiendo finalizar.
- [ ] El pedido por faltante de un producto con `piso2 = 5` cobra `precioVenta` si faltan 4 y `precio2` si faltan 5.
- [ ] En Rutas → Historial la entrega recién liquidada dice «Liquidado».

**Cierre**

- [ ] `npm test` pasa en `rapidix-api` y en `rapidix-web`.
- [ ] `npx tsc --noEmit -p tsconfig.json` en la API y `npm run build` en la web terminan sin errores.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** el real baja al recolectar. Es la regla del negocio: el estante se vacía cuando el pedido sube al camión, no cuando el cliente lo recibe.
- **No:** mantener «en ruta» como saldo informativo encima del real (lo que estaba en staging). Obligaba a restar de cabeza para saber qué hay en bodega.
- **Sí:** motivo nuevo `RUTA` para la salida y el regreso. **No:** reusar `ENTREGA`; en Movimientos se leería «Entrega» de algo que el cliente aún no tiene.
- **Sí:** el pedido no entregado recupera solo el real. Sigue siendo de su cliente, así que conserva su apartado en ATP. **No:** subir también ATP; otro cliente podría comprar esa mercancía y el pedido volvería a salir sin ella.
- **Sí:** lo rechazado de un pedido entregado vuelve con dos movimientos, `RUTA` al físico y `DEVOLUCION` a ATP. **No:** un solo movimiento `AMBOS`; cada uno se deduce de una cuenta distinta y por separado ninguno puede entrar dos veces.
- **Sí:** con `controlInventario` apagado solo se mueve «en ruta». **No:** apagar también «en ruta»; encender el interruptor con un camión en la calle lo dejaría descuadrado.
- **Sí:** el corte del repartidor sigue descargando el camión. El SPEC 04 moverá ese paso a «Aceptar devolución». Así el inventario cuadra entre un spec y otro.
- **Sí:** sin migración de datos para los camiones ya cargados. Las cuentas se deducen de los movimientos: un pedido sin salida `RUTA` se comporta como antes. **No:** un `UPDATE` que baje el físico de lo que ya va en ruta; habría que fabricar renglones de bitácora con saldos congelados que nadie vio.
- **Sí:** «Devuelto» obligatorio en cada producto con devolución y validado en la API. **No:** tomar el campo vacío como «devolvió todo»; es justo el caso que esconde un faltante.
- **Sí:** el pedido por faltante no toca el inventario. Sus piezas salieron del real al recolectar y dejan «en ruta» cuando el corte cierra los renglones. **No:** bajarlas de «en ruta» al generar el faltante; el corte las restaría otra vez.
- **Sí:** cancelar un pedido por faltante no devuelve mercancía. Lo que faltó no existe en bodega.
- **Sí:** precio del faltante por las listas de precios, con la cantidad faltante del producto. **No:** siempre lista 1, que es lo que hacía.
- **Sí:** el dinero que no cuadra sigue sin bloquear. La diferencia queda escrita y se cubre con abonos (SPEC 04).
- **Sí:** «Liquidado» es solo la etiqueta de `EstadoCorte.CERRADO`. **No:** renombrar el enum ahora; el SPEC 04 lo redefine entero y serían dos migraciones del mismo enum.
- **Sí:** un solo spec para inventario y liquidación, y otro para Finanzas y CXC. **No:** un spec con todo el ciclo; tocaba cuatro dominios.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Recolectar empieza a fallar por falta de físico donde antes pasaba (el descuadre aparecía al entregar). | El error sale en bodega, donde se puede corregir con un `AJUSTE`, y no en la puerta del cliente. El mensaje nombra el producto. |
| Pedidos recolectados antes del despliegue conviven con los nuevos. | Las funciones puras deducen de los movimientos escritos: sin salida `RUTA` el pedido sigue la regla anterior. Hay un criterio de aceptación para ese caso. |
| Una pantalla abierta con la versión anterior manda el corte sin `devueltos`. | El `ValidationPipe` responde 400 y no se cierra nada; al recargar ya manda el campo. |
| El faltante se reparte entre varios pedidos del mismo producto y el físico regresa de más o de menos. | El reparto vive en `planDeDescarga()`, puro y probado: la suma de lo que regresa por producto es igual a la «Devolución» del conteo. |
| «En ruta» queda en cero por el `GREATEST` aunque haya un descuadre. | Sigue siendo la suma de renglones abiertos de `carga_repartidor`: se puede recalcular con la consulta de la migración `20261001120000_inventario_en_ruta`. |

---

## Lo que **no** está en este spec

- Aceptar dinero, aceptar devolución y «Entrega aceptada» en Finanzas.
- Los estatus Aceptado y Cerrado, y la pestaña Ingresos.
- Rechazar una devolución y reanudar la entrega.
- CXC.
- Desglose de «en ruta» por camión, entrega o pedido.

Los cuatro primeros son el SPEC 04. El desglose, si llega, va en su propio spec.
