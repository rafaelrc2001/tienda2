import { EstadoPago, EstadoPedido } from '@prisma/client';
import { botonesDePago, ESTADOS_PAGO, evaluarCambioPago, PedidoEnPago } from './flujo-pago';

const pedido = (cambios: Partial<PedidoEnPago> = {}): PedidoEnPago => ({
  estado: EstadoPedido.CONFIRMADO,
  estadoPago: EstadoPago.PAGO_PENDIENTE,
  ...cambios,
});

/** El codigo del bloqueo, o la accion que se permite. */
const resultado = (p: PedidoEnPago, destino: EstadoPago, nota = false): string => {
  const r = evaluarCambioPago(p, destino, nota);
  return 'bloqueo' in r ? r.bloqueo.codigo : r.accion;
};

describe('eje de pago', () => {
  it('va de cualquier estado a cualquier otro, sin orden', () => {
    for (const desde of ESTADOS_PAGO) {
      if (desde === EstadoPago.CANCELADO) continue;
      for (const hasta of ESTADOS_PAGO) {
        if (hasta === desde) continue;
        expect(resultado(pedido({ estadoPago: desde }), hasta)).toBe('cambiar');
      }
    }
  });

  it('no repite el estatus que ya tiene', () => {
    expect(resultado(pedido({ estadoPago: EstadoPago.RETENER }), EstadoPago.RETENER)).toBe(
      'MISMO_ESTADO',
    );
  });

  it('avanzar en el eje fisico no estorba al del dinero', () => {
    const enRuta = pedido({ estado: EstadoPedido.EN_RUTA, estadoPago: EstadoPago.LIBERAR });
    expect(resultado(enRuta, EstadoPago.PAGADO)).toBe('cambiar');
    expect(resultado(enRuta, EstadoPago.RETENER)).toBe('cambiar');
  });
});

describe('cancelar', () => {
  it('se puede mientras la mercancia siga en bodega', () => {
    for (const estado of [
      EstadoPedido.CONFIRMADO,
      EstadoPedido.EN_PREPARACION,
      EstadoPedido.PREPARADO,
      EstadoPedido.LISTO_PARA_ENTREGA,
    ]) {
      expect(resultado(pedido({ estado }), EstadoPago.CANCELADO)).toBe('cambiar');
    }
  });

  it('no se puede una vez que la mercancia salio', () => {
    for (const estado of [
      EstadoPedido.RECOLECTADO,
      EstadoPedido.EN_RUTA,
      EstadoPedido.ENTREGADO,
    ]) {
      expect(resultado(pedido({ estado }), EstadoPago.CANCELADO)).toBe('MERCANCIA_FUERA');
    }
  });

  it('un pedido ya pagado todavia se puede cancelar', () => {
    expect(resultado(pedido({ estadoPago: EstadoPago.PAGADO }), EstadoPago.CANCELADO)).toBe(
      'cambiar',
    );
  });

  it('es terminal: de cancelado no se sale', () => {
    const cancelado = pedido({ estadoPago: EstadoPago.CANCELADO });
    for (const hasta of ESTADOS_PAGO) {
      if (hasta === EstadoPago.CANCELADO) continue;
      expect(resultado(cancelado, hasta)).toBe('PAGO_TERMINAL');
    }
  });

  it('con una nota se acepta re-cancelar, solo para aclarar el motivo', () => {
    const cancelado = pedido({ estadoPago: EstadoPago.CANCELADO });
    expect(resultado(cancelado, EstadoPago.CANCELADO, true)).toBe('aclaracion');
    expect(resultado(cancelado, EstadoPago.CANCELADO, false)).toBe('PAGO_TERMINAL');
  });
});

describe('botonesDePago', () => {
  it('devuelve los siete, en el orden del prototipo', () => {
    expect(botonesDePago(pedido()).map((b) => b.estado)).toEqual(ESTADOS_PAGO);
  });

  it('marca el actual sin tratarlo como bloqueado', () => {
    const boton = botonesDePago(pedido({ estadoPago: EstadoPago.LIBERAR })).find(
      (b) => b.estado === EstadoPago.LIBERAR,
    );
    expect(boton).toMatchObject({ actual: true, bloqueo: null });
  });

  it('explica el candado de la mercancia que ya salio', () => {
    const botones = botonesDePago(pedido({ estado: EstadoPedido.EN_RUTA }));
    const cancelar = botones.find((b) => b.estado === EstadoPago.CANCELADO);
    expect(cancelar?.bloqueo?.codigo).toBe('MERCANCIA_FUERA');
    // Los demas siguen disponibles: cancelar es el unico que frena.
    expect(botones.filter((b) => b.bloqueo !== null)).toHaveLength(1);
  });

  it('en un pedido cancelado los apaga todos', () => {
    const botones = botonesDePago(pedido({ estadoPago: EstadoPago.CANCELADO }));
    expect(botones.filter((b) => b.bloqueo === null && !b.actual)).toHaveLength(0);
  });
});
