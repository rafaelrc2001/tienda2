import { EstadoPago, EstadoPedido, MetodoEntrega, MetodoPago } from '@prisma/client';
import {
  esLiberado,
  evaluarAvance,
  PedidoEnFlujo,
  pagoCubierto,
  pasoPendiente,
  siguientePaso,
} from './flujo';

const pedido = (cambios: Partial<PedidoEnFlujo> = {}): PedidoEnFlujo => ({
  estado: EstadoPedido.CONFIRMADO,
  estadoPago: EstadoPago.PAGO_PENDIENTE,
  metodoEntrega: MetodoEntrega.DOMICILIO,
  metodoPago: MetodoPago.EFECTIVO,
  ...cambios,
});

/** El codigo del bloqueo, o `null` si el paso se permite. */
const codigo = (p: PedidoEnFlujo, destino: EstadoPedido): string | null => {
  const r = evaluarAvance(p, destino);
  return 'bloqueo' in r ? r.bloqueo.codigo : null;
};

/** Recorre los pasos de `siguientePaso` desde CONFIRMADO. */
const recorrido = (base: PedidoEnFlujo): EstadoPedido[] => {
  const pasos: EstadoPedido[] = [];
  let actual = base;
  for (let paso = siguientePaso(actual); paso; paso = siguientePaso(actual)) {
    expect(codigo(actual, paso.a)).toBeNull();
    pasos.push(paso.a);
    actual = { ...actual, estado: paso.a };
  }
  return pasos;
};

describe('flujo del pedido', () => {
  it('a domicilio recorre los siete estados pasando por Rutas', () => {
    expect(recorrido(pedido())).toEqual([
      EstadoPedido.EN_PREPARACION,
      EstadoPedido.PREPARADO,
      EstadoPedido.LISTO_PARA_ENTREGA,
      EstadoPedido.RECOLECTADO,
      EstadoPedido.EN_RUTA,
      EstadoPedido.ENTREGADO,
    ]);
  });

  it('en tienda se entrega directo desde "Listo para entrega"', () => {
    expect(recorrido(pedido({ metodoEntrega: MetodoEntrega.TIENDA }))).toEqual([
      EstadoPedido.EN_PREPARACION,
      EstadoPedido.PREPARADO,
      EstadoPedido.LISTO_PARA_ENTREGA,
      EstadoPedido.ENTREGADO,
    ]);
  });

  it('los pasos de Operaciones y de Rutas quedan en su seccion', () => {
    const listo = pedido({ estado: EstadoPedido.LISTO_PARA_ENTREGA });
    expect(siguientePaso(pedido())?.seccion).toBe('operaciones');
    expect(siguientePaso(listo)?.seccion).toBe('rutas');
    expect(siguientePaso({ ...listo, metodoEntrega: MetodoEntrega.TIENDA })?.seccion).toBe(
      'operaciones',
    );
  });

  it('entregado ya no tiene siguiente paso', () => {
    expect(siguientePaso(pedido({ estado: EstadoPedido.ENTREGADO }))).toBeNull();
  });

  it('no se salta pasos ni se retrocede', () => {
    expect(codigo(pedido(), EstadoPedido.PREPARADO)).toBe('TRANSICION_INVALIDA');
    expect(codigo(pedido({ estado: EstadoPedido.PREPARADO }), EstadoPedido.EN_PREPARACION)).toBe(
      'TRANSICION_INVALIDA',
    );
    expect(codigo(pedido(), EstadoPedido.CONFIRMADO)).toBe('TRANSICION_INVALIDA');
  });

  it('respeta el modo de entrega al salir de "Listo para entrega"', () => {
    const listo = pedido({ estado: EstadoPedido.LISTO_PARA_ENTREGA });
    expect(codigo(listo, EstadoPedido.ENTREGADO)).toBe('SOLO_EN_TIENDA');
    expect(
      codigo({ ...listo, metodoEntrega: MetodoEntrega.TIENDA }, EstadoPedido.RECOLECTADO),
    ).toBe('SOLO_A_DOMICILIO');
  });
});

describe('pasoPendiente', () => {
  it('dice el siguiente paso, a quien le toca y que lo frena', () => {
    expect(
      pasoPendiente(pedido({ estado: EstadoPedido.PREPARADO, estadoPago: EstadoPago.RETENER })),
    ).toEqual({
      siguiente: EstadoPedido.LISTO_PARA_ENTREGA,
      seccion: 'operaciones',
      bloqueo: expect.objectContaining({ codigo: 'PAGO_RETENIDO' }) as unknown,
    });
  });

  it('con pago pendiente, el de tienda enciende "Listo para entrega" en Operaciones', () => {
    const tienda = pedido({
      estado: EstadoPedido.PREPARADO,
      estadoPago: EstadoPago.PAGO_PENDIENTE,
      metodoEntrega: MetodoEntrega.TIENDA,
    });
    expect(pasoPendiente(tienda)).toEqual({
      siguiente: EstadoPedido.LISTO_PARA_ENTREGA,
      seccion: 'operaciones',
      bloqueo: null,
    });
    expect(pasoPendiente({ ...tienda, estado: EstadoPedido.LISTO_PARA_ENTREGA })).toEqual({
      siguiente: EstadoPedido.ENTREGADO,
      seccion: 'operaciones',
      bloqueo: null,
    });
  });

  it('con pago pendiente, el de domicilio pasa a Rutas sin candado', () => {
    const domicilio = pedido({
      estado: EstadoPedido.LISTO_PARA_ENTREGA,
      estadoPago: EstadoPago.PAGO_PENDIENTE,
      metodoEntrega: MetodoEntrega.DOMICILIO,
    });
    expect(pasoPendiente(domicilio)).toEqual({
      siguiente: EstadoPedido.RECOLECTADO,
      seccion: 'rutas',
      bloqueo: null,
    });
  });

  it('sin bloqueo cuando ya se puede dar', () => {
    expect(pasoPendiente(pedido()).bloqueo).toBeNull();
  });

  it('entregado no tiene paso pendiente', () => {
    expect(pasoPendiente(pedido({ estado: EstadoPedido.ENTREGADO }))).toEqual({
      siguiente: null,
      seccion: null,
      bloqueo: null,
    });
  });
});

describe('candados de Finanzas', () => {
  it('con pago pendiente avanza hasta la entrega sin esperar a Finanzas', () => {
    const pendiente = { estadoPago: EstadoPago.PAGO_PENDIENTE };
    expect(codigo(pedido(pendiente), EstadoPedido.EN_PREPARACION)).toBeNull();
    expect(
      codigo(
        pedido({ ...pendiente, estado: EstadoPedido.PREPARADO }),
        EstadoPedido.LISTO_PARA_ENTREGA,
      ),
    ).toBeNull();
    expect(
      codigo(
        pedido({ ...pendiente, estado: EstadoPedido.LISTO_PARA_ENTREGA }),
        EstadoPedido.RECOLECTADO,
      ),
    ).toBeNull();
  });

  it('retenido no deja ni empezar a preparar', () => {
    expect(codigo(pedido({ estadoPago: EstadoPago.RETENER }), EstadoPedido.EN_PREPARACION)).toBe(
      'PAGO_RETENIDO',
    );
  });

  it('cancelado no avanza, aunque cuente como liberado', () => {
    expect(esLiberado(EstadoPago.CANCELADO)).toBe(true);
    expect(codigo(pedido({ estadoPago: EstadoPago.CANCELADO }), EstadoPedido.EN_PREPARACION)).toBe(
      'PEDIDO_CANCELADO',
    );
  });

  it('solo retenido no cuenta como liberado', () => {
    const liberados = Object.values(EstadoPago).filter(esLiberado);
    expect(liberados.sort()).toEqual(
      [
        EstadoPago.PAGO_PENDIENTE,
        EstadoPago.CREDITO,
        EstadoPago.REEMBOLSADO,
        EstadoPago.PAGADO,
        EstadoPago.CANCELADO,
      ].sort(),
    );
  });

  it('transferencia sin pagar llega hasta la puerta pero no se entrega', () => {
    const transferencia = {
      metodoPago: MetodoPago.TRANSFERENCIA,
      estadoPago: EstadoPago.PAGO_PENDIENTE,
    };
    // Todo lo anterior sigue abierto: el candado es solo el ultimo paso.
    expect(
      codigo(pedido({ ...transferencia, estado: EstadoPedido.RECOLECTADO }), EstadoPedido.EN_RUTA),
    ).toBeNull();
    expect(
      codigo(pedido({ ...transferencia, estado: EstadoPedido.EN_RUTA }), EstadoPedido.ENTREGADO),
    ).toBe('PAGO_NO_CUBIERTO');
    expect(
      codigo(
        pedido({
          ...transferencia,
          estado: EstadoPedido.LISTO_PARA_ENTREGA,
          metodoEntrega: MetodoEntrega.TIENDA,
        }),
        EstadoPedido.ENTREGADO,
      ),
    ).toBe('PAGO_NO_CUBIERTO');
  });

  it('Pagado o Crédito dejan entregar la transferencia', () => {
    for (const estadoPago of [EstadoPago.PAGADO, EstadoPago.CREDITO]) {
      expect(
        codigo(
          pedido({
            metodoPago: MetodoPago.TRANSFERENCIA,
            estadoPago,
            estado: EstadoPedido.EN_RUTA,
          }),
          EstadoPedido.ENTREGADO,
        ),
      ).toBeNull();
    }
  });

  it('el efectivo se entrega con el pago pendiente: se cobra en la puerta', () => {
    expect(
      codigo(
        pedido({ estadoPago: EstadoPago.PAGO_PENDIENTE, estado: EstadoPedido.EN_RUTA }),
        EstadoPedido.ENTREGADO,
      ),
    ).toBeNull();
  });

  it.each([
    [MetodoPago.EFECTIVO, EstadoPago.PAGO_PENDIENTE, true],
    [MetodoPago.EFECTIVO, EstadoPago.REEMBOLSADO, false],
    [MetodoPago.TRANSFERENCIA, EstadoPago.PAGO_PENDIENTE, false],
    [MetodoPago.TRANSFERENCIA, EstadoPago.CREDITO, true],
    [MetodoPago.TRANSFERENCIA, EstadoPago.PAGADO, true],
  ])('pagoCubierto(%s, %s) = %s', (metodo, estado, esperado) => {
    expect(pagoCubierto(metodo, estado)).toBe(esperado);
  });

  it('un paso que no existe se explica antes que el pago', () => {
    expect(codigo(pedido({ estadoPago: EstadoPago.RETENER }), EstadoPedido.ENTREGADO)).toBe(
      'TRANSICION_INVALIDA',
    );
  });
});
