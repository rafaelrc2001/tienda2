import { AfectaInventario, MotivoMovimiento, TipoMovimiento } from '@prisma/client';
import { devolucionesDeRuta, MovimientoDelPedido, salidasAlEntregar } from './salidas-del-pedido';

/** La venta de hoy: aparta 10 piezas, solo del saldo de venta. */
const venta = (productoId: string, cantidad: number): MovimientoDelPedido => ({
  productoId,
  cantidad,
  tipo: TipoMovimiento.SALIDA,
  afecta: AfectaInventario.APT,
  motivo: MotivoMovimiento.VENTA,
});

const entrega = (productoId: string, cantidad: number): MovimientoDelPedido => ({
  productoId,
  cantidad,
  tipo: TipoMovimiento.SALIDA,
  afecta: AfectaInventario.FISICO,
  motivo: MotivoMovimiento.ENTREGA,
});

const devolucion = (productoId: string, cantidad: number): MovimientoDelPedido => ({
  productoId,
  cantidad,
  tipo: TipoMovimiento.ENTRADA,
  afecta: AfectaInventario.APT,
  motivo: MotivoMovimiento.DEVOLUCION,
});

describe('salidasAlEntregar', () => {
  it('entrega completa: sale del físico todo lo apartado', () => {
    expect(
      salidasAlEntregar([venta('arroz', 10)], [{ productoId: 'arroz', cantidad: 10 }]),
    ).toEqual([{ productoId: 'arroz', cantidad: 10 }]);
  });

  it('entrega parcial: solo sale lo que el cliente aceptó', () => {
    expect(salidasAlEntregar([venta('arroz', 10)], [{ productoId: 'arroz', cantidad: 7 }])).toEqual(
      [{ productoId: 'arroz', cantidad: 7 }],
    );
  });

  it('lo no aceptado no genera movimiento', () => {
    expect(salidasAlEntregar([venta('arroz', 10)], [{ productoId: 'arroz', cantidad: 0 }])).toEqual(
      [],
    );
  });

  it('con el control apagado —sin VENTA— no saca nada', () => {
    expect(salidasAlEntregar([], [{ productoId: 'arroz', cantidad: 10 }])).toEqual([]);
  });

  it('un pedido de antes, que vendió con AMBOS, ya bajó el físico: no sale otra vez', () => {
    const vieja = { ...venta('arroz', 10), afecta: AfectaInventario.AMBOS };
    expect(salidasAlEntregar([vieja], [{ productoId: 'arroz', cantidad: 10 }])).toEqual([]);
  });

  it('entregar dos veces no saca de más', () => {
    const hecho = [venta('arroz', 10), entrega('arroz', 10)];
    expect(salidasAlEntregar(hecho, [{ productoId: 'arroz', cantidad: 10 }])).toEqual([]);
  });

  it('nunca saca más de lo apartado', () => {
    expect(salidasAlEntregar([venta('arroz', 4)], [{ productoId: 'arroz', cantidad: 10 }])).toEqual(
      [{ productoId: 'arroz', cantidad: 4 }],
    );
  });

  it('un producto en varios renglones sale en un solo movimiento', () => {
    expect(
      salidasAlEntregar(
        [venta('arroz', 6), venta('frijol', 2)],
        [
          { productoId: 'arroz', cantidad: 2 },
          { productoId: 'arroz', cantidad: 3 },
          { productoId: 'frijol', cantidad: 2 },
        ],
      ),
    ).toEqual([
      { productoId: 'arroz', cantidad: 5 },
      { productoId: 'frijol', cantidad: 2 },
    ]);
  });
});

describe('devolucionesDeRuta', () => {
  it('lo rechazado vuelve con el alcance de la venta: solo apt., el físico no se toca', () => {
    expect(
      devolucionesDeRuta([venta('arroz', 10)], [{ productoId: 'arroz', cantidad: 3 }]),
    ).toEqual([{ productoId: 'arroz', cantidad: 3, afecta: AfectaInventario.APT }]);
  });

  it('la ENTREGA no cuenta como algo que haya que devolver', () => {
    expect(
      devolucionesDeRuta(
        [venta('arroz', 10), entrega('arroz', 7)],
        [{ productoId: 'arroz', cantidad: 3 }],
      ),
    ).toEqual([{ productoId: 'arroz', cantidad: 3, afecta: AfectaInventario.APT }]);
  });

  it('sin VENTA (control apagado) no devuelve nada', () => {
    expect(devolucionesDeRuta([], [{ productoId: 'arroz', cantidad: 3 }])).toEqual([]);
  });

  it('devolver dos veces no infla el saldo', () => {
    expect(
      devolucionesDeRuta(
        [venta('arroz', 10), devolucion('arroz', 10)],
        [{ productoId: 'arroz', cantidad: 3 }],
      ),
    ).toEqual([]);
  });

  it('el tope se gasta entre renglones del mismo producto', () => {
    expect(
      devolucionesDeRuta(
        [venta('arroz', 4)],
        [
          { productoId: 'arroz', cantidad: 3 },
          { productoId: 'arroz', cantidad: 3 },
        ],
      ),
    ).toEqual([
      { productoId: 'arroz', cantidad: 3, afecta: AfectaInventario.APT },
      { productoId: 'arroz', cantidad: 1, afecta: AfectaInventario.APT },
    ]);
  });
});
