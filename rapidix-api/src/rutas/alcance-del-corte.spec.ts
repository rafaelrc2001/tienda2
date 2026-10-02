import { EstadoPago, EstadoPedido, MetodoPago, Prisma } from '@prisma/client';
import {
  alcanceDeLaDescarga,
  alcanceDelCorte,
  cuentaDelCorte,
  PedidoDelAlcance,
  planDeDescarga,
  RenglonADescargar,
} from './alcance-del-corte';

const D = (n: number) => new Prisma.Decimal(n);

describe('alcanceDelCorte', () => {
  const entrega = { entregaId: 'e2', sesionId: 's1', finalizadaEn: null };

  it('con otras entregas sin liquidar: solo sus pedidos', () => {
    const alcance = alcanceDelCorte({ ...entrega, otrasVivas: 1 });
    expect(alcance.cierraJornada).toBe(false);
    expect(alcance.pedidos).toEqual({ entregaRutaId: 'e2' });
  });

  it('la última sin liquidar se lleva lo que no tiene entrega', () => {
    const alcance = alcanceDelCorte({ ...entrega, otrasVivas: 0 });
    expect(alcance.cierraJornada).toBe(true);
    expect(alcance.pedidos).toEqual({ OR: [{ entregaRutaId: 'e2' }, { entregaRutaId: null }] });
  });

  it('conserva cuándo se finalizó para no pisarlo al cortar', () => {
    const finalizadaEn = new Date('2026-09-25T18:00:00Z');
    expect(alcanceDelCorte({ ...entrega, finalizadaEn, otrasVivas: 0 }).finalizadaEn).toBe(
      finalizadaEn,
    );
  });
});

describe('alcanceDeLaDescarga', () => {
  const entrega = { entregaId: 'e2', sesionId: 's1' };

  it('con otras entregas vivas: solo su parte del camión, y la jornada sigue', () => {
    const alcance = alcanceDeLaDescarga({ ...entrega, otrasVivas: 1 });
    expect(alcance.cierraJornada).toBe(false);
    expect(alcance.cargas).toEqual({
      sesionId: 's1',
      cerradoEn: null,
      pedido: { entregaRutaId: 'e2' },
    });
  });

  it('la última viva cierra la jornada y baja también lo que no tiene entrega', () => {
    const alcance = alcanceDeLaDescarga({ ...entrega, otrasVivas: 0 });
    expect(alcance.cierraJornada).toBe(true);
    expect(alcance.cargas).toEqual({
      sesionId: 's1',
      cerradoEn: null,
      pedido: { OR: [{ entregaRutaId: 'e2' }, { entregaRutaId: null }] },
    });
  });

  it('nunca baja lo de otra entrega de la misma jornada', () => {
    // Ni siquiera la que cierra la jornada: lo de otra entrega lo baja su
    // propia devolución, que es quien lo contó.
    const { cargas } = alcanceDeLaDescarga({ ...entrega, otrasVivas: 0 });
    expect(JSON.stringify(cargas)).not.toContain('e1');
    expect(cargas.pedido).not.toBeUndefined();
  });
});

/**
 * Efectivo pendiente, $100 de mercancía: 10 piezas a $10. Entregado, su total
 * ya es lo que se quedó el cliente, como lo deja la entrega.
 */
const pedido = (
  id: string,
  estado: EstadoPedido,
  entregadas: number,
  metodoPago: MetodoPago = MetodoPago.EFECTIVO,
): PedidoDelAlcance => ({
  id,
  estado,
  metodoPago,
  estadoPago: EstadoPago.PAGO_PENDIENTE,
  total: D(estado === EstadoPedido.ENTREGADO ? entregadas * 10 : 100),
  pagadoConBilletera: D(0),
  cargas: [
    {
      cantidadCargada: 10,
      cantidadEntregada: entregadas,
      precioUnitario: D(10),
      precioEntregado: null,
    },
  ],
});

describe('cuentaDelCorte', () => {
  it('suma el efectivo de lo entregado', () => {
    const cuenta = cuentaDelCorte([
      pedido('a', EstadoPedido.ENTREGADO, 10),
      pedido('b', EstadoPedido.ENTREGADO, 10),
    ]);
    expect(cuenta.montoCalculado.toNumber()).toBe(200);
    expect(cuenta.pedidosQueRegresan).toBe(0);
    expect(cuenta.piezasQueRegresan).toBe(0);
  });

  it('entrega parcial: cobra lo aceptado y cuenta lo que regresa', () => {
    const cuenta = cuentaDelCorte([pedido('a', EstadoPedido.ENTREGADO, 7)]);
    expect(cuenta.montoCalculado.toNumber()).toBe(70);
    expect(cuenta.piezasQueRegresan).toBe(3);
    expect(cuenta.pedidosQueRegresan).toBe(0);
  });

  it('lo que no se entregó no cobra nada, aunque sea efectivo pendiente', () => {
    const cuenta = cuentaDelCorte([
      pedido('a', EstadoPedido.EN_RUTA, 0),
      pedido('b', EstadoPedido.RECOLECTADO, 0),
    ]);
    expect(cuenta.montoCalculado.toNumber()).toBe(0);
    expect(cuenta.pedidosQueRegresan).toBe(2);
    expect(cuenta.piezasQueRegresan).toBe(20);
  });

  it('una transferencia entregada no trae efectivo', () => {
    const cuenta = cuentaDelCorte([
      pedido('a', EstadoPedido.ENTREGADO, 10, MetodoPago.TRANSFERENCIA),
    ]);
    expect(cuenta.montoCalculado.toNumber()).toBe(0);
  });

  it('devuelve el desglose en el orden en que llegaron', () => {
    const cuenta = cuentaDelCorte([
      pedido('a', EstadoPedido.ENTREGADO, 10),
      pedido('b', EstadoPedido.EN_RUTA, 0),
    ]);
    expect(cuenta.porPedido.map((p) => [p.id, p.efectivo.toNumber(), p.devueltas])).toEqual([
      ['a', 100, 0],
      ['b', 0, 10],
    ]);
  });
});

const renglon = (
  id: string,
  pedidoId: string,
  estado: EstadoPedido,
  cargadas: number,
  entregadas: number,
  productoId = 'arroz',
): RenglonADescargar => ({
  id,
  pedidoId,
  productoId,
  cantidadCargada: cargadas,
  cantidadEntregada: entregadas,
  pedido: { folio: `ORD-${pedidoId}`, estado },
});

describe('planDeDescarga', () => {
  it('cierra todos los renglones, también los que no devuelven nada', () => {
    const plan = planDeDescarga([renglon('c1', 'a', EstadoPedido.ENTREGADO, 10, 10)], true);
    expect(plan.cierres).toEqual([{ id: 'c1', cantidadDevuelta: 0 }]);
    expect(plan.pedidos).toEqual([]);
  });

  it('lo rechazado de un entregado se libera y el pedido no vuelve a la cola', () => {
    const plan = planDeDescarga([renglon('c1', 'a', EstadoPedido.ENTREGADO, 10, 7)], true);
    expect(plan.pedidos).toEqual([
      {
        pedidoId: 'a',
        folio: 'ORD-a',
        estado: EstadoPedido.ENTREGADO,
        lineas: [{ productoId: 'arroz', cantidad: 3 }],
        liberaInventario: true,
        vuelveACola: false,
        alFisico: [{ productoId: 'arroz', cantidad: 3 }],
      },
    ]);
  });

  it('el que no se entregó vuelve a la cola y conserva su apartado', () => {
    const plan = planDeDescarga([renglon('c1', 'b', EstadoPedido.EN_RUTA, 10, 0)], true);
    expect(plan.pedidos[0]).toMatchObject({ liberaInventario: false, vuelveACola: true });
  });

  it('el que no se entregó vuelve entero al físico aunque no se libere para venta', () => {
    const plan = planDeDescarga([renglon('c1', 'b', EstadoPedido.EN_RUTA, 4, 0)], true);
    expect(plan.pedidos[0].alFisico).toEqual([{ productoId: 'arroz', cantidad: 4 }]);
  });

  it('con el control apagado nada vuelve al físico', () => {
    const plan = planDeDescarga(
      [
        renglon('c1', 'a', EstadoPedido.ENTREGADO, 10, 7),
        renglon('c2', 'b', EstadoPedido.RECOLECTADO, 5, 0),
      ],
      false,
    );
    expect(plan.pedidos.map((p) => p.alFisico)).toEqual([[], []]);
  });

  it('lo cobrado como faltante no vuelve al físico', () => {
    // Rechazó 1, se contó 0 al bajar y se cobró como faltante: no regresa nada.
    const plan = planDeDescarga(
      [renglon('c1', 'a', EstadoPedido.ENTREGADO, 4, 3)],
      true,
      new Map([['arroz', 1]]),
    );
    expect(plan.pedidos[0].alFisico).toEqual([]);
  });

  it('el faltante que sobra de los rechazados se descuenta de los que regresan enteros', () => {
    // Bajan 2 rechazados y 5 de un pedido sin entregar; faltan 3. El que
    // regresa va primero en la lista y aun así el faltante se gasta antes en
    // el entregado.
    const plan = planDeDescarga(
      [
        renglon('c1', 'c', EstadoPedido.EN_RUTA, 5, 0),
        renglon('c2', 'a', EstadoPedido.ENTREGADO, 4, 2),
      ],
      true,
      new Map([['arroz', 3]]),
    );
    expect(plan.pedidos.map((p) => [p.pedidoId, p.alFisico])).toEqual([
      ['c', [{ productoId: 'arroz', cantidad: 4 }]],
      ['a', []],
    ]);
    // El que regresa conserva sus líneas enteras: son su pedido, no lo liberado.
    expect(plan.pedidos[0].lineas).toEqual([{ productoId: 'arroz', cantidad: 5 }]);
  });

  it('lo que vuelve al físico de cada producto es lo que baja menos el faltante', () => {
    const plan = planDeDescarga(
      [
        renglon('c1', 'a', EstadoPedido.ENTREGADO, 3, 1),
        renglon('c2', 'b', EstadoPedido.ENTREGADO, 4, 0),
        renglon('c3', 'c', EstadoPedido.EN_RUTA, 5, 0),
      ],
      true,
      new Map([['arroz', 5]]),
    );
    const vuelven = plan.pedidos.flatMap((p) => p.alFisico).reduce((n, l) => n + l.cantidad, 0);
    // Bajan 2 + 4 + 5 = 11 y faltan 5.
    expect(vuelven).toBe(6);
  });

  it('con el control apagado no libera nada, pero el no entregado vuelve igual', () => {
    const plan = planDeDescarga(
      [
        renglon('c1', 'a', EstadoPedido.ENTREGADO, 10, 7),
        renglon('c2', 'b', EstadoPedido.RECOLECTADO, 5, 0),
      ],
      false,
    );
    expect(plan.pedidos.map((p) => [p.pedidoId, p.liberaInventario, p.vuelveACola])).toEqual([
      ['a', false, false],
      ['b', false, true],
    ]);
  });

  it('junta los renglones del mismo pedido', () => {
    const plan = planDeDescarga(
      [
        renglon('c1', 'a', EstadoPedido.ENTREGADO, 10, 8, 'arroz'),
        renglon('c2', 'a', EstadoPedido.ENTREGADO, 4, 0, 'frijol'),
      ],
      true,
    );
    expect(plan.pedidos).toHaveLength(1);
    expect(plan.pedidos[0].lineas).toEqual([
      { productoId: 'arroz', cantidad: 2 },
      { productoId: 'frijol', cantidad: 4 },
    ]);
  });

  it('lo cobrado como faltante no se libera: solo lo que de verdad bajó', () => {
    // Rechazaron 7 y bajó 1: los 6 del faltante no vuelven a venta.
    const plan = planDeDescarga(
      [renglon('c1', 'a', EstadoPedido.ENTREGADO, 7, 0)],
      true,
      new Map([['arroz', 6]]),
    );
    expect(plan.cierres).toEqual([{ id: 'c1', cantidadDevuelta: 7 }]);
    expect(plan.pedidos[0].lineas).toEqual([{ productoId: 'arroz', cantidad: 1 }]);
  });

  it('el faltante se reparte entre los rechazados y no pasa a los que vuelven a la cola', () => {
    const plan = planDeDescarga(
      [
        renglon('c1', 'a', EstadoPedido.ENTREGADO, 3, 1),
        renglon('c2', 'b', EstadoPedido.ENTREGADO, 4, 0),
        renglon('c3', 'c', EstadoPedido.EN_RUTA, 5, 0),
      ],
      true,
      new Map([['arroz', 5]]),
    );
    // a rechazó 2 y b 4: se descuentan 2 de a (queda sin líneas) y 3 de b.
    expect(plan.pedidos.map((p) => [p.pedidoId, p.lineas])).toEqual([
      ['a', []],
      ['b', [{ productoId: 'arroz', cantidad: 1 }]],
      ['c', [{ productoId: 'arroz', cantidad: 5 }]],
    ]);
  });
});
