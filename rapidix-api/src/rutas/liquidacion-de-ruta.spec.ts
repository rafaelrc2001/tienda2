import { EstadoPago, EstadoPedido, MotivoDevolucion, Prisma } from '@prisma/client';
import {
  conteoPorProducto,
  esDevolucion,
  esEntregado,
  indicadoresDeRuta,
  indicadoresDelHistorial,
  intentoDeEntrega,
  productosDeLaLinea,
  RenglonConProducto,
  ResultadoDelIntento,
  saldoDelCorte,
} from './liquidacion-de-ruta';

const D = (n: number | string) => new Prisma.Decimal(n);

const vivo = (estado: EstadoPedido) => ({ estado, estadoPago: EstadoPago.PAGO_PENDIENTE });
const cancelado = (estado: EstadoPedido) => ({ estado, estadoPago: EstadoPago.CANCELADO });

describe('esDevolucion / esEntregado', () => {
  it('lo que se quedó en el camión es devolución', () => {
    expect(esDevolucion(vivo(EstadoPedido.RECOLECTADO))).toBe(true);
    expect(esDevolucion(vivo(EstadoPedido.EN_RUTA))).toBe(true);
    expect(esDevolucion(vivo(EstadoPedido.ENTREGADO))).toBe(false);
  });

  it('un cancelado es devolución aunque su caja diga Entregado', () => {
    const pedido = cancelado(EstadoPedido.ENTREGADO);
    expect(esDevolucion(pedido)).toBe(true);
    expect(esEntregado(pedido)).toBe(false);
  });
});

describe('indicadoresDeRuta', () => {
  it('sin pedidos todo es cero', () => {
    expect(indicadoresDeRuta([])).toEqual({ pedidos: 0, entregados: 0, devoluciones: 0 });
  });

  it('entregados + devoluciones no tiene por qué dar el total', () => {
    expect(
      indicadoresDeRuta([
        vivo(EstadoPedido.ENTREGADO),
        vivo(EstadoPedido.EN_RUTA),
        cancelado(EstadoPedido.ENTREGADO),
      ]),
    ).toEqual({ pedidos: 3, entregados: 1, devoluciones: 2 });
  });
});

describe('indicadoresDelHistorial', () => {
  it('parcial es entregado; devuelto y cancelado son devolución', () => {
    expect(
      indicadoresDelHistorial([
        ResultadoDelIntento.ENTREGADO,
        ResultadoDelIntento.PARCIAL,
        ResultadoDelIntento.DEVUELTO,
        ResultadoDelIntento.CANCELADO,
      ]),
    ).toEqual({ pedidos: 4, entregados: 2, devoluciones: 2 });
  });
});

const renglon = (
  productoId: string,
  nombre: string,
  cargada: number,
  entregada: number,
): RenglonConProducto => ({
  productoId,
  nombre,
  unidad: 'pza',
  cantidadCargada: cargada,
  cantidadEntregada: entregada,
});

describe('conteoPorProducto', () => {
  it('suma el mismo producto de varios pedidos y cuadra cargado − entregado', () => {
    const conteo = conteoPorProducto([
      renglon('pan', 'Pan para torta', 6, 4),
      renglon('ceb', 'Cebolla', 20, 15),
      renglon('pan', 'Pan para torta', 6, 4),
    ]);
    expect(conteo).toEqual([
      {
        productoId: 'ceb',
        nombre: 'Cebolla',
        unidad: 'pza',
        cargado: 20,
        entregado: 15,
        devolucion: 5,
      },
      {
        productoId: 'pan',
        nombre: 'Pan para torta',
        unidad: 'pza',
        cargado: 12,
        entregado: 8,
        devolucion: 4,
      },
    ]);
  });
});

describe('productosDeLaLinea', () => {
  const renglones = [renglon('pol', 'Pollo', 2, 1), renglon('ceb', 'Cebolla', 3, 0)];

  it('en una entrega dice lo aceptado y quita lo aceptado en cero', () => {
    expect(productosDeLaLinea(false, renglones)).toEqual([
      { nombre: 'Pollo', unidad: 'pza', cantidad: 1 },
    ]);
  });

  it('en una devolución dice lo que vuelve a bodega', () => {
    expect(productosDeLaLinea(true, renglones).map((p) => p.cantidad)).toEqual([2, 3]);
  });
});

describe('intentoDeEntrega', () => {
  const cerrado = new Date('2026-09-28T20:00:00Z');
  const completo = { cantidadCargada: 2, cantidadEntregada: 2, motivoDevolucion: null };

  it('entregado aquí con un renglón corto es parcial', () => {
    const intento = intentoDeEntrega(
      { ...vivo(EstadoPedido.ENTREGADO), entregaRutaId: 'e1' },
      'e1',
      [
        { ...completo, cerradoEn: null },
        {
          cantidadCargada: 3,
          cantidadEntregada: 1,
          motivoDevolucion: MotivoDevolucion.DANADO,
          cerradoEn: null,
        },
      ],
    );
    expect(intento.resultado).toBe(ResultadoDelIntento.PARCIAL);
    expect(intento.renglones[1]).toEqual({ cantidad: 3, recibido: 1, motivo: 'DANADO' });
  });

  it('entregado después en otra entrega: aquí fue devolución', () => {
    const intento = intentoDeEntrega(
      { ...vivo(EstadoPedido.ENTREGADO), entregaRutaId: 'e2' },
      'e1',
      [{ cantidadCargada: 2, cantidadEntregada: 0, motivoDevolucion: null, cerradoEn: cerrado }],
    );
    expect(intento.resultado).toBe(ResultadoDelIntento.DEVUELTO);
    expect(intento.renglones[0].recibido).toBe(0);
  });

  it('sigue en el camión: lo recibido no se sabe todavía', () => {
    const intento = intentoDeEntrega({ ...vivo(EstadoPedido.EN_RUTA), entregaRutaId: 'e1' }, 'e1', [
      { cantidadCargada: 2, cantidadEntregada: 0, motivoDevolucion: null, cerradoEn: null },
    ]);
    expect(intento.resultado).toBe(ResultadoDelIntento.EN_RUTA);
    expect(intento.renglones[0].recibido).toBeNull();
  });

  it('cancelado manda sobre lo demás', () => {
    const intento = intentoDeEntrega(
      { ...cancelado(EstadoPedido.EN_RUTA), entregaRutaId: 'e1' },
      'e1',
      [{ ...completo, cerradoEn: null }],
    );
    expect(intento.resultado).toBe(ResultadoDelIntento.CANCELADO);
  });
});

describe('saldoDelCorte', () => {
  it('sin contar no hay saldo', () => {
    expect(saldoDelCorte(D(100), null, D(0)).toNumber()).toBe(0);
  });

  it('se mide contra lo contado y resta los abonos', () => {
    expect(saldoDelCorte(D(100), D(70), D(10)).toNumber()).toBe(20);
  });

  it('medio centavo o menos ya está saldado', () => {
    expect(saldoDelCorte(D(100), D('99.996'), D(0)).toNumber()).toBe(0);
  });

  it('entregar de más no deja saldo negativo', () => {
    expect(saldoDelCorte(D(100), D(120), D(0)).toNumber()).toBe(0);
  });
});
