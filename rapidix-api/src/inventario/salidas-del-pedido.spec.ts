import { AfectaInventario, MotivoMovimiento, TipoMovimiento } from '@prisma/client';
import {
  devolucionesDeRuta,
  MovimientoDelPedido,
  regresosDeRuta,
  salidasAlEntregar,
  salidasARuta,
} from './salidas-del-pedido';

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

/** Sube al camión: sale del físico al recolectar. */
const aRuta = (productoId: string, cantidad: number): MovimientoDelPedido => ({
  productoId,
  cantidad,
  tipo: TipoMovimiento.SALIDA,
  afecta: AfectaInventario.FISICO,
  motivo: MotivoMovimiento.RUTA,
});

/** Baja del camión: vuelve al físico. */
const deRuta = (productoId: string, cantidad: number): MovimientoDelPedido => ({
  ...aRuta(productoId, cantidad),
  tipo: TipoMovimiento.ENTRADA,
});

describe('salidasARuta', () => {
  it('recolectar saca del físico todo lo apartado', () => {
    expect(salidasARuta([venta('arroz', 4)], [{ productoId: 'arroz', cantidad: 4 }])).toEqual([
      { productoId: 'arroz', cantidad: 4 },
    ]);
  });

  it('con el control apagado —sin VENTA— no saca nada', () => {
    expect(salidasARuta([], [{ productoId: 'arroz', cantidad: 4 }])).toEqual([]);
  });

  it('recolectar dos veces no saca de más', () => {
    const hecho = [venta('arroz', 4), aRuta('arroz', 4)];
    expect(salidasARuta(hecho, [{ productoId: 'arroz', cantidad: 4 }])).toEqual([]);
  });

  it('el pedido que regresó de ruta vuelve a salir otro día', () => {
    const hecho = [venta('arroz', 4), aRuta('arroz', 4), deRuta('arroz', 4)];
    expect(salidasARuta(hecho, [{ productoId: 'arroz', cantidad: 4 }])).toEqual([
      { productoId: 'arroz', cantidad: 4 },
    ]);
  });

  it('un producto en varios renglones sale en un solo movimiento', () => {
    expect(
      salidasARuta(
        [venta('arroz', 5)],
        [
          { productoId: 'arroz', cantidad: 2 },
          { productoId: 'arroz', cantidad: 3 },
        ],
      ),
    ).toEqual([{ productoId: 'arroz', cantidad: 5 }]);
  });
});

describe('regresosDeRuta', () => {
  it('quitar de la entrega devuelve al físico todo lo que subió', () => {
    expect(
      regresosDeRuta(
        [venta('arroz', 4), aRuta('arroz', 4)],
        [{ productoId: 'arroz', cantidad: 4 }],
      ),
    ).toEqual([{ productoId: 'arroz', cantidad: 4 }]);
  });

  it('en el corte vuelve solo lo que baja del camión', () => {
    expect(
      regresosDeRuta(
        [venta('arroz', 4), aRuta('arroz', 4)],
        [{ productoId: 'arroz', cantidad: 1 }],
      ),
    ).toEqual([{ productoId: 'arroz', cantidad: 1 }]);
  });

  it('un pedido recolectado antes de RUTA no devuelve nada: su físico nunca bajó al subir', () => {
    expect(regresosDeRuta([venta('arroz', 4)], [{ productoId: 'arroz', cantidad: 4 }])).toEqual([]);
  });

  it('con el control apagado —sin movimientos— no devuelve nada', () => {
    expect(regresosDeRuta([], [{ productoId: 'arroz', cantidad: 4 }])).toEqual([]);
  });

  it('descargar dos veces no infla el saldo', () => {
    const hecho = [venta('arroz', 4), aRuta('arroz', 4), deRuta('arroz', 4)];
    expect(regresosDeRuta(hecho, [{ productoId: 'arroz', cantidad: 4 }])).toEqual([]);
  });

  it('nunca vuelve más de lo que sigue arriba, y en un solo movimiento por producto', () => {
    expect(
      regresosDeRuta(
        [venta('arroz', 4), aRuta('arroz', 4), deRuta('arroz', 1)],
        [
          { productoId: 'arroz', cantidad: 2 },
          { productoId: 'arroz', cantidad: 2 },
        ],
      ),
    ).toEqual([{ productoId: 'arroz', cantidad: 3 }]);
  });
});

describe('salidasAlEntregar', () => {
  it('un pedido recolectado ya sacó su físico al subir: entregarlo no saca nada', () => {
    const hecho = [venta('arroz', 4), aRuta('arroz', 4)];
    expect(salidasAlEntregar(hecho, [{ productoId: 'arroz', cantidad: 3 }])).toEqual([]);
  });

  it('un pedido recolectado antes de RUTA sigue sacando su físico al entregarse', () => {
    expect(salidasAlEntregar([venta('arroz', 4)], [{ productoId: 'arroz', cantidad: 4 }])).toEqual([
      { productoId: 'arroz', cantidad: 4 },
    ]);
  });

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
