# SPEC 04 — Cortes de ruta, ingresos y cuentas por cobrar

> **Estado:** aprovado
> **Depende de:** SPEC 01, SPEC 02, SPEC 03
> **Fecha:** 2026-10-01
> **Objetivo:** Hacer que Finanzas acepte la devolución y el dinero de cada entrega liquidada —con sus estatus, sus ingresos y los abonos del repartidor— y lleve las cuentas por cobrar de los pedidos entregados a crédito.

---

## 1. Por qué existe este spec

Hoy «Finalizar liquidación» hace todo de un golpe: descarga el camión, devuelve la mercancía al inventario y cierra la jornada, sin que nadie de bodega o Finanzas haya visto lo que regresó. Después Finanzas *captura* cuánto contó y el corte pasa a «recibido»; los abonos del repartidor entran sin que nadie los acepte, el dinero aceptado no queda en ningún libro, y un pedido en efectivo entregado sigue en «Pago pendiente» hasta que alguien lo marca a mano.

Este spec parte ese momento en pasos con dueño:

1. El repartidor **liquida**: cuenta lo que baja y declara su dinero. La entrega queda **Liquidado**. Nada se mueve en el inventario todavía.
2. Finanzas revisa la mercancía y pulsa **Aceptar devolución** (ahí vuelve al inventario) o la **rechaza** (la liquidación se deshace).
3. Finanzas cuenta el dinero y pulsa **Aceptar dinero**: nace un **ingreso**.
4. Finanzas pulsa **Entrega aceptada**: los pedidos en efectivo quedan pagados, los de crédito entran a **CXC**, y la entrega queda **Cerrado** si el repartidor no debe nada o **Aceptado** si debe.
5. Si debe, el repartidor **abona** desde su historial (vuelve a Liquidado), Finanzas acepta ese dinero (otro ingreso) y, al cubrirse todo, queda **Cerrado**.

```
                 rechazar devolución
        ┌──────────────────────────────────┐
        ▼                                  │
 (sin liquidar) ──finalizar liquidación──▶ LIQUIDADO ──entrega aceptada──▶ CERRADO
                                           ▲    │                            ▲
                                    abono  │    │ entrega aceptada           │ aceptar dinero
                                           │    ▼ (con adeudo)               │ (cubre todo)
                                           └─ ACEPTADO ◀── aceptar dinero ───┘
                                                           (aún debe)
```

---

## 2. Alcance

**Dentro:**

- Estatus del corte en la base: `LIQUIDADO`, `ACEPTADO`, `CERRADO`, con migración de los cortes que ya existen.
- Folio único y consecutivo por entrega (`REP000123`), visible en Rutas, en Cortes de ruta y en Ingresos.
- «Finalizar liquidación» deja de descargar el camión y de cerrar la jornada.
- «Aceptar devolución»: descarga el camión (lo que hacía el corte en el SPEC 03) y cierra la jornada si era su última entrega.
- «Rechazar devolución» con motivo: deshace la liquidación y la entrega vuelve a «terminada, sin liquidar».
- «Aceptar dinero»: acepta lo declarado sin capturar otra cifra y registra el ingreso. Solo tras aceptar la devolución.
- «Entrega aceptada»: pedidos en efectivo a Pagado (con su cashback), pedidos a crédito a CXC, estatus Aceptado o Cerrado.
- Abonos del repartidor: quedan pendientes hasta que Finanzas los acepta; el repartidor puede cancelar el suyo mientras tanto.
- Rutas → Historial: columna de adeudo y estatus nuevo por entrega.
- Pestaña **Ingresos** en Finanzas: fecha y hora, concepto, folio, cantidad; filtro por fechas y concepto; total del rango.
- Pestaña **CXC** en Finanzas: pedidos a crédito entregados, con productos, pagos y saldo; registro de pagos parciales.
- Un pedido a crédito recogido en tienda entra a CXC al entregarse.
- Actualizar `rapidix-api/ESTRUCTURA.md`.

**Fuera de alcance (specs futuros):**

- Registrar como ingreso las transferencias validadas y las ventas en tienda. Ingresos solo lleva los conceptos Entrega y CXC.
- Exportar Ingresos o CXC, y reportes por repartidor o por periodo.
- Pagar una CXC con saldo de billetera.
- Límite de crédito por cliente, vencimientos e intereses.
- Editar o borrar un ingreso ya registrado.
- Marcar Pagado de forma retroactiva los pedidos en efectivo de cortes recibidos antes del despliegue.
- Desglose de «en ruta» por camión (ya quedó fuera en el SPEC 03).

---

## 3. Modelo de datos

### 3.1 `EstadoCorte`

```prisma
/// LIQUIDADO: el repartidor liquido (o abono) y Finanzas tiene algo por aceptar.
/// ACEPTADO:  Finanzas acepto la entrega y el repartidor aun debe dinero.
/// CERRADO:   aceptada y sin adeudo. Terminal.
enum EstadoCorte {
  LIQUIDADO
  ACEPTADO
  CERRADO
}
```

El valor viejo `CERRADO` (recién liquidado) pasa a llamarse `LIQUIDADO`; `RECIBIDO` pasa a `ACEPTADO`, y los que no deben nada suben al `CERRADO` nuevo.

### 3.2 Cambios en tablas existentes

```prisma
model Corte {
  // ...lo que ya tiene. `montoRecibido`, `recibidoEn` y `recibidoPorId` pasan
  // a ser "el dinero aceptado": lo declarado en el momento de aceptarlo.
  devolucionAceptadaEn    DateTime?
  devolucionAceptadaPorId String?
  entregaAceptadaEn       DateTime?
  entregaAceptadaPorId    String?
  estado EstadoCorte @default(LIQUIDADO)
  ingresos Ingreso[]
}

model CorteAbono {
  // ...lo que ya tiene.
  /// Null mientras Finanzas no lo acepte: no cuenta contra el adeudo.
  aceptadoEn    DateTime?
  aceptadoPorId String?
  ingreso       Ingreso?
}

model EntregaRuta {
  // ...lo que ya tiene.
  /// REP000123, de la secuencia `entregas_ruta_folio_seq`.
  folio String @unique
  /// El motivo del ultimo rechazo de su devolucion. Se limpia al volver a liquidar.
  rechazoDevolucion   String?
  rechazoDevolucionEn DateTime?
}

model Pedido {
  // ...lo que ya tiene.
  /// Desde cuando es cuenta por cobrar: entregado a credito con saldo.
  cxcDesde DateTime?
  pagos    PagoPedido[]
}
```

### 3.3 Tablas nuevas

```prisma
enum ConceptoIngreso {
  ENTREGA
  CXC
}

/// El libro de lo que Finanzas acepto. Solo se escribe, nunca se edita.
model Ingreso {
  id       String          @id @default(uuid())
  concepto ConceptoIngreso
  /// Folio de reparto (ENTREGA) o de pedido (CXC), congelado.
  referencia String
  monto      Decimal    @db.Decimal(12, 2)
  metodo     MetodoPago
  nota       String?

  corteId      String?
  corte        Corte?      @relation(fields: [corteId], references: [id])
  /// Si el ingreso es un abono. Uno por abono.
  corteAbonoId String?     @unique
  corteAbono   CorteAbono? @relation(fields: [corteAbonoId], references: [id])
  /// Si el ingreso es un pago de CXC. Uno por pago.
  pagoPedidoId String?     @unique
  pagoPedido   PagoPedido? @relation(fields: [pagoPedidoId], references: [id])

  registradoPorId String
  registradoPor   Usuario  @relation(fields: [registradoPorId], references: [id])
  creadoEn        DateTime @default(now())

  @@index([creadoEn])
  @@index([concepto, creadoEn])
  @@map("ingresos")
}

/// Un pago recibido por un pedido que es cuenta por cobrar.
model PagoPedido {
  id       String  @id @default(uuid())
  pedidoId String
  pedido   Pedido  @relation(fields: [pedidoId], references: [id])
  monto    Decimal    @db.Decimal(12, 2)
  metodo   MetodoPago
  nota     String?
  registradoPorId String
  registradoPor   Usuario  @relation(fields: [registradoPorId], references: [id])
  creadoEn        DateTime @default(now())
  ingreso         Ingreso?

  @@index([pedidoId])
  @@map("pagos_pedido")
}
```

### 3.4 Las cuentas

- **Adeudo del repartidor** = `montoCalculado − montoRecibido − abonos aceptados`, nunca menor que cero. Sin dinero aceptado todavía no hay adeudo. Declarar de más no deja saldo a favor.
- **Saldo de un pedido** = `total − pagadoConBilletera − suma de sus pagos`.
- **CXC** = pedidos con `cxcDesde` no nulo. «Con saldo» mientras el saldo sea mayor que cero; «Cobradas» después.
- **Jornada viva** = sin corte. Una entrega cuenta como viva para la jornada mientras su devolución no esté aceptada.

### 3.5 Endpoints

Sección `finanzas`, salvo los dos de `rutas`.

| Método y ruta | Qué hace | Errores (409) |
| --- | --- | --- |
| `GET /admin/finanzas/cortes?filtro=` | `por-aceptar` (LIQUIDADO), `con-adeudo` (ACEPTADO), `cerrados` (CERRADO). Sustituye a `por-recibir` / `recibidos`. | — |
| `GET /admin/finanzas/cortes/:id` | El corte con su conteo por producto y sus pedidos. | — |
| `POST /admin/finanzas/cortes/:id/aceptar-devolucion` | Descarga el camión y estampa la aceptación. | `DEVOLUCION_YA_ACEPTADA`, `RECIBE_EL_MISMO` |
| `POST /admin/finanzas/cortes/:id/rechazar-devolucion` `{ motivo }` | Deshace la liquidación. | `DEVOLUCION_YA_ACEPTADA` |
| `POST /admin/finanzas/cortes/:id/aceptar-dinero` | Acepta lo declarado o el abono pendiente; crea el ingreso. | `DEVOLUCION_SIN_ACEPTAR`, `SIN_DINERO_POR_ACEPTAR`, `RECIBE_EL_MISMO` |
| `POST /admin/finanzas/cortes/:id/aceptar-entrega` | Pedidos a Pagado o a CXC; estatus Aceptado o Cerrado. | `DEVOLUCION_SIN_ACEPTAR`, `DINERO_SIN_ACEPTAR`, `ENTREGA_YA_ACEPTADA` |
| `GET /admin/finanzas/ingresos?desde=&hasta=&concepto=` | Ingresos del rango y su `total`. Por defecto, hoy. | — |
| `GET /admin/finanzas/cxc?filtro=` | `con-saldo` o `cobradas`, con productos, pagos y saldo. | — |
| `POST /admin/finanzas/cxc/:pedidoId/pagos` `{ monto, metodo, nota? }` | Registra el pago y su ingreso; en cero, el pedido queda Pagado. | `PAGO_EXCEDE_SALDO`, `NO_ES_CXC` |
| `POST /admin/rutas/cortes/:id/abonos` (existe) | Ahora nace pendiente y deja el corte en LIQUIDADO. | `ENTREGA_SIN_ACEPTAR`, `ABONO_PENDIENTE`, `ABONO_EXCEDE_FALTANTE` |
| `DELETE /admin/rutas/cortes/:id/abonos/:abonoId` | El repartidor cancela su abono pendiente. | `ABONO_YA_ACEPTADO`, `CORTE_DE_OTRO` |

Desaparecen `POST /admin/finanzas/cortes/:id/recibir` y `POST /admin/finanzas/cortes/:id/abonos`.

`PATCH /admin/finanzas/pedidos/:id/pago` responde 409 `PEDIDO_EN_CXC` si se intenta marcar Pagado a mano un pedido con `cxcDesde` y saldo: se cobra desde CXC.

---

## 4. Plan de implementación

**Base de datos.**

1. Migración `20261001140000_estados_del_corte`: renombra `CERRADO`→`LIQUIDADO` y `RECIBIDO`→`ACEPTADO` y añade el valor `CERRADO`. Actualizar el enum en `schema.prisma` y todos los usos de `EstadoCorte` en `src/rutas` para que compile con el mismo comportamiento de hoy.
2. Migración `20261001150000_cortes_de_ruta`: columnas nuevas de `cortes`, `cortes_abonos`, `entregas_ruta` y `pedidos`; secuencia `entregas_ruta_folio_seq`; tablas `ingresos` y `pagos_pedido`; enum `ConceptoIngreso`. Siembra: folio de las entregas por `creadoEn`; `devolucionAceptadaEn = cerradoEn` en todos los cortes; en los ya recibidos, `entregaAceptadaEn = recibidoEn`, abonos con `aceptadoEn = creadoEn`, un ingreso por lo recibido y uno por abono, y `CERRADO` si no deben; `cxcDesde = liquidadoEn` (o `creadoEn` en tienda) para los pedidos a crédito ya entregados. `npx prisma generate`.

**Ingresos (API).**

3. Módulo `src/ingresos/`: `IngresosService.registrar(tx, …)` y `listar(desde, hasta, concepto)` con su total; `AdminIngresosController` en `admin/finanzas/ingresos`; registrado en `app.module.ts`.

**Cortes de ruta (API).**

4. `RutasService.crearEntrega()` asigna el folio de la secuencia; `EntregaRutaDto` y `CorteDto` lo exponen.
5. Funciones puras en `src/rutas/estado-del-corte.ts`: `adeudoDelCorte()` (sustituye a `saldoDelCorte()`, cuenta solo abonos aceptados) y `estadoTrasAceptar()`. Pruebas en `estado-del-corte.spec.ts`.
6. `CortesService.cerrar()` deja de llamar a `descargarCamion()` y de atar la jornada; limpia `rechazoDevolucion` de la entrega. `alcance()` y `RutasService` tratan como viva para la jornada la entrega con devolución sin aceptar.
7. `CortesService.aceptarDevolucion()`: descarga el camión con el alcance del corte, estampa la aceptación y cierra la jornada si no queda otra entrega viva. Ruta en `finanzas-cortes.controller.ts`.
8. `CortesService.rechazarDevolucion()`: suelta los pedidos (`liquidado`, `corteId`), suelta la entrega, guarda el motivo en ella y borra el corte. `ResumenCorteDto` y `EntregaRutaDto` exponen el motivo.
9. `CortesService.aceptarDinero()`: primera vez, `montoRecibido = montoDeclarado` y su ingreso; después, acepta el abono pendiente y su ingreso; recalcula el estatus con `estadoTrasAceptar()`. Sustituye a `recibir()`.
10. `FinanzasService.marcarPagado(tx, pedidoId, quien, nota)`: extraído de `cambiarPago()`, que pasa a llamarlo.
11. `CortesService.aceptarEntrega()`: pedidos en efectivo del corte a Pagado con `marcarPagado()`, pedidos a crédito con saldo a CXC, estatus con `estadoTrasAceptar()`.
12. Abonos: `abonarPropio()` exige `ACEPTADO`, crea el abono pendiente y deja el corte en `LIQUIDADO`; `cancelarAbono()` nuevo; se borra `abonar()` de Finanzas. `corregirDeclarado()` se permite mientras el dinero no esté aceptado.
13. `listar()` con los filtros nuevos y `detalle()` con conteo y pedidos; `historial()` del repartidor expone adeudo y abono pendiente.

**CXC (API).**

14. Función pura `saldoDelPedido()` en `src/pedidos/cxc.ts`, con pruebas en `cxc.spec.ts`.
15. `CxcService` y `CxcController` en `src/pedidos/` (`admin/finanzas/cxc`): listar y registrar pago, con su ingreso y `marcarPagado()` al llegar a cero.
16. `FlujoPedidosService`: un pedido a crédito con saldo que se entrega en tienda recibe `cxcDesde`. `evaluarCambioPago()` bloquea Pagado a mano con `PEDIDO_EN_CXC`.

**Frontend.**

17. `src/api/tipos.ts`: `EstadoCorte`, `Corte`, `FiltroCortes`, `Ingreso`, `PedidoCxc`, folio y motivo de rechazo en `EntregaRuta`.
18. `views/admin/rutas/liquidacion.ts`: `estadoEnHistorial()`, `accionDelCorte()` y `faltanteDe()` con los estatus nuevos y el abono pendiente; pruebas en `liquidacion.spec.ts`.
19. `FinanzasCortesView.vue` pasa a «Cortes de ruta»: pestañas Por aceptar / Con adeudo / Cerrados; por corte, sección «Entrega de devolución» (tabla del conteo, Aceptar y Rechazar con motivo), sección «Entrega de efectivo» (calculado, declarado, Aceptar dinero) y botón «Entrega aceptada».
20. Rutas: folio en la cabecera de la entrega y en las listas; aviso del rechazo en `LiquidacionEntregaView.vue`; `VentanaHistorial.vue` con columnas Estatus y Adeudo; `DetalleHistorialEntrega.vue` con «Entregar dinero» y «Cancelar abono».
21. `FinanzasIngresosView.vue` en `/admin/finanzas/ingresos`: tabla, filtro de fechas y concepto, total.
22. `FinanzasCxcView.vue` en `/admin/finanzas/cxc`: tabla de pedidos con detalle desplegable (productos, cómo se cubrió, pagos) y hoja «Registrar pago».
23. `FinanzasView.vue`: enlaces a Cortes de ruta, Ingresos y CXC. Rutas nuevas en `router/index.ts`.

**Cierre.**

24. Actualizar `rapidix-api/ESTRUCTURA.md` y los comentarios de `schema.prisma`.

---

## 5. Criterios de aceptación

**Liquidación y devolución**

- [ ] Tras «Finalizar liquidación» el corte nace `LIQUIDADO`, los saldos de inventario no cambian y los renglones de `carga_repartidor` siguen abiertos.
- [ ] Con la devolución de su última entrega sin aceptar, el repartidor puede crear otra entrega y `POST /admin/rutas/jornada` no abre una jornada nueva.
- [ ] «Aceptar devolución» deja el producto de ejemplo del SPEC 03 (aceptó 3 de 4) en 7 / 7 / 0 y cierra los renglones.
- [ ] Aceptar la devolución de la última entrega viva cierra la jornada.
- [ ] Aceptar dos veces responde 409 `DEVOLUCION_YA_ACEPTADA` y no mueve el inventario otra vez.
- [ ] «Rechazar devolución» sin motivo responde 400; con motivo, borra el corte, la entrega aparece en Rutas → Liquidación con el motivo a la vista y sus pedidos vuelven a `liquidado = false`.
- [ ] Tras un rechazo el repartidor puede reanudar la entrega, y los pedidos por faltante que había generado siguen en ella.
- [ ] Rechazar con la devolución ya aceptada responde 409.

**Dinero y estatus**

- [ ] «Aceptar dinero» antes de aceptar la devolución responde 409 `DEVOLUCION_SIN_ACEPTAR`.
- [ ] Aceptar un corte de $500 declarados crea un ingreso `ENTREGA` de $500 con el folio de reparto, y `montoRecibido` queda en 500.
- [ ] El repartidor puede corregir lo declarado hasta que el dinero se acepta; después responde 409 `CORTE_RECIBIDO`.
- [ ] «Entrega aceptada» sin dinero aceptado responde 409 `DINERO_SIN_ACEPTAR`.
- [ ] Con calculado $500 y aceptado $500, «Entrega aceptada» deja el corte `CERRADO`.
- [ ] Con calculado $500 y aceptado $400, lo deja `ACEPTADO` con adeudo $100.
- [ ] Un abono de $60 deja el corte `LIQUIDADO` y el adeudo sigue en $100; al aceptarlo hay un ingreso `ENTREGA` de $60, el adeudo es $40 y el estatus `ACEPTADO`.
- [ ] Un segundo abono con otro pendiente responde 409 `ABONO_PENDIENTE`; uno mayor que el adeudo, 409 `ABONO_EXCEDE_FALTANTE`.
- [ ] Cancelar el abono pendiente lo borra y el corte vuelve a `ACEPTADO`; cancelar uno aceptado responde 409.
- [ ] Al aceptar el abono que cubre el adeudo, el corte queda `CERRADO` sin pulsar nada más.
- [ ] Quien liquidó no puede aceptar su propio corte (409 `RECIBE_EL_MISMO`), salvo el administrador.

**Pedidos y CXC**

- [ ] «Entrega aceptada» pasa a `PAGADO` los pedidos en efectivo entregados del corte, incluidos los de faltante, y acredita su cashback una sola vez.
- [ ] Un pedido a crédito de $300 con $50 de billetera entra a CXC con saldo $250.
- [ ] Un pago de $100 deja saldo $150, crea un ingreso `CXC` con el folio del pedido y el pedido sigue en `CREDITO`.
- [ ] Un pago mayor que el saldo responde 409 `PAGO_EXCEDE_SALDO`.
- [ ] El pago que deja el saldo en cero pasa el pedido a `PAGADO`, acredita su cashback y lo mueve a «Cobradas».
- [ ] Marcar Pagado a mano un pedido de CXC con saldo responde 409 `PEDIDO_EN_CXC`.
- [ ] Un pedido a crédito entregado en tienda aparece en CXC.

**Pantallas**

- [ ] Cortes de ruta tiene las pestañas Por aceptar, Con adeudo y Cerrados, y cada corte muestra su folio de reparto.
- [ ] «Aceptar dinero» está deshabilitado hasta aceptar la devolución; «Entrega aceptada», hasta aceptar las dos.
- [ ] Rutas → Historial muestra por entrega el estatus (Liquidado, Aceptado, Cerrado) y el adeudo.
- [ ] Ingresos muestra fecha y hora, concepto, folio y cantidad; el filtro por fechas y concepto cambia la lista y el total, y el total viene de la API.
- [ ] CXC muestra por pedido sus productos, cómo se cubrió, las fechas de sus pagos y el saldo.

**Migración y cierre**

- [ ] Tras migrar, no queda ningún corte en un estatus viejo, todas las entregas tienen folio único y cada corte recibido tiene sus ingresos.
- [ ] `npm test` pasa en `rapidix-api` y en `rapidix-web`.
- [ ] `npx tsc --noEmit -p tsconfig.json` en la API y `npm run build` en la web terminan sin errores.

---

## 6. Decisiones tomadas y descartadas

- **Sí:** el camión se descarga al «Aceptar devolución». La mercancía vuelve al inventario cuando alguien distinto del repartidor la vio. **No:** al liquidar, como dejó el SPEC 03 de forma provisional.
- **Sí:** rechazar la devolución deshace la liquidación entera. Con el camión sin descargar, deshacer es soltar pedidos y borrar el corte. **No:** reabrir solo el conteo; el repartidor no podría reanudar la entrega.
- **Sí:** primero devolución, luego dinero. Nunca hay un ingreso sobre una liquidación que luego se deshace. **No:** orden libre.
- **Sí:** Finanzas acepta lo declarado sin capturar otra cifra. Si no coincide, el repartidor corrige lo declarado. **No:** capturar lo contado, como hoy.
- **Sí:** se reusan `montoRecibido`, `recibidoEn` y `recibidoPorId` como «dinero aceptado». **No:** renombrarlas; es la misma fotografía y ahorra una migración de datos.
- **Sí:** tras la primera «Entrega aceptada», el estatus cambia solo al aceptar cada abono. **No:** volver a pulsar el botón.
- **Sí:** los pedidos en efectivo quedan Pagado al aceptar la entrega, aunque el repartidor deba. El cliente ya pagó; el adeudo es del repartidor. **No:** esperar a Cerrado ni seguir a mano.
- **Sí:** la jornada se cierra al aceptar la devolución de su última entrega. Un rechazo siempre encuentra la jornada abierta. **No:** cerrarla al liquidar; chocaría con el índice de «una jornada viva por repartidor».
- **Sí:** un abono pendiente a la vez, cancelable por el repartidor. **No:** que Finanzas lo rechace; el dinero es del repartidor hasta que se acepta.
- **Sí:** folio de reparto sin guion (`REP000123`), como el de los pedidos (`ORD000123`).
- **Sí:** `Ingreso` guarda la referencia como texto congelado, igual que los cupones emitidos congelan sus condiciones.
- **Sí:** Ingresos con filtro por fechas, concepto y total calculado en la API. **No:** solo la tabla; ni exportación, que va aparte.
- **Sí:** CXC con pagos parciales y tabla `pagos_pedido`. **No:** solo consulta.
- **Sí:** el crédito recogido en tienda entra a CXC, y los créditos ya entregados se siembran en la migración. **No:** solo los de ruta.
- **Sí:** un pedido de CXC no se marca Pagado a mano. Si no, tendría saldo y estaría pagado a la vez.
- **Sí:** la pestaña «Crédito» de Finanzas se queda. Lista también los créditos que aún no se entregan, que no son CXC.
- **Sí:** los cortes viejos se convierten y generan sus ingresos. **No:** arrancar Ingresos vacío.
- **No:** marcar Pagado de forma retroactiva los pedidos de cortes viejos. Acreditaría cashback en masa sin que nadie lo revise.
- **Sí:** el pedido que regresa sin entregarse conserva su apartado, como en el SPEC 03.
- **Sí:** un solo spec para Finanzas y CXC, por decisión tomada al partir el trabajo. **No:** CXC aparte.

---

## 7. Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| La migración de enum renombra `CERRADO` y luego crea otro `CERRADO` con otro significado. | Dos migraciones: la primera renombra y añade; la segunda, ya en otra transacción, usa el valor nuevo. El paso 1 deja el código compilando contra los nombres nuevos antes de cambiar comportamiento. |
| El repartidor no puede abrir jornada nueva si Finanzas tarda en aceptar su devolución. | Puede crear otra entrega en la misma jornada y seguir repartiendo. La pestaña «Por aceptar» de Finanzas es la cola de lo que lo está frenando. |
| Entre liquidar y aceptar la devolución, la mercancía devuelta sigue en «en ruta» aunque ya esté en bodega. | Es deliberado: no cuenta en el físico hasta que Finanzas la vio. El criterio de aceptación comprueba que los saldos no cambian al liquidar. |
| «Entrega aceptada» acredita cashback de muchos pedidos de un golpe. | `marcarPagado()` es el mismo camino idempotente que usa Finanzas hoy; un pedido que ya pasó por Pagado no acredita otra vez. |
| Un pedido se cancela después de entrar a un corte o a CXC. | La cancelación sigue su regla de hoy. Un pedido cancelado sale de «Con saldo» porque CXC lista solo `CREDITO`. |
| Cortes viejos de jornada entera, sin entrega propia, no tienen folio de reparto. | Su ingreso sembrado lleva la referencia `S/F` y la fecha del corte. |
| Una pantalla abierta con la versión anterior llama a `recibir` o al abono de Finanzas. | Responden 404; al recargar aparecen los botones nuevos. |

---

## Lo que **no** está en este spec

- Transferencias validadas y ventas en tienda como ingresos.
- Exportar Ingresos o CXC, y reportes.
- Pagar una CXC con billetera.
- Límite de crédito, vencimientos e intereses.
- Editar o borrar ingresos.
- Pagado retroactivo de pedidos de cortes viejos.

Cada uno, si llega, va en su propio spec.
