import { EstadoPago, EstadoPedido, MetodoPago, Prisma } from '@prisma/client';
import {
  alcanceDelCorte,
  cuentaDelCorte,
  PedidoDelAlcance,
  planDeDescarga,
  RenglonADescargar,
} from './alcance-del-corte';

const D = (n: number) => new Prisma.Decimal(n);

describe('alcanceDelCorte', () => {
  const entrega = { entregaId: 'e2', sesionId: 's1', finalizadaEn: null };

  it('con otras entregas vivas: solo sus pedidos y su parte del camión', () => {
    const alcance = alcanceDelCorte({ ...entrega, otrasVivas: 1 });
    expect(alcance.cierraJornada).toBe(false);
    expect(alcance.pedidos).toEqual({ entregaRutaId: 'e2' });
    expect(alcance.cargas).toEqual({
      sesionId: 's1',
      cerradoEn: null,
      pedido: { entregaRutaId: 'e2' },
    });
  });

  it('la última viva cierra la jornada y se lleva lo que no tiene entrega', () => {
    const alcance = alcanceDelCorte({ ...entrega, otrasVivas: 0 });
    expect(alcance.cierraJornada).toBe(true);
    expect(alcance.pedidos).toEqual({ OR: [{ entregaRutaId: 'e2' }, { entregaRutaId: null }] });
    // Todo lo abierto de la jornada: el camión queda vacío.
    expect(alcance.cargas).toEqual({ sesionId: 's1', cerradoEn: null });
  });

  it('conserva cuándo se finalizó para no pisarlo al cortar', () => {
    const finalizadaEn = new Date('2026-09-25T18:00:00Z');
    expect(alcanceDelCorte({ ...entrega, finalizadaEn, otrasVivas: 0 }).finalizadaEn).toBe(
      finalizadaEn,
    );
  });
});

/** Efectivo pendiente, $100 de mercancía: 10 piezas a $10. */
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
  total: D(100),
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
      },
    ]);
  });

  it('el que no se entregó vuelve a la cola y conserva su apartado', () => {
    const plan = planDeDescarga([renglon('c1', 'b', EstadoPedido.EN_RUTA, 10, 0)], true);
    expect(plan.pedidos[0]).toMatchObject({ liberaInventario: false, vuelveACola: true });
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
});
