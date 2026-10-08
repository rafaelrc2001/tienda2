import { EstadoPago, EstadoPedido, MetodoEntrega, MetodoPago, Prisma } from '@prisma/client';
import { PedidoDelTurno, productosEntregados, totalesDelTurno } from './corte-de-caja';

const Decimal = Prisma.Decimal;

function pedido(cambios: Partial<Omit<PedidoDelTurno, 'total'>> & { total?: number } = {}) {
  return {
    estado: EstadoPedido.ENTREGADO,
    estadoPago: EstadoPago.PAGADO,
    metodoPago: MetodoPago.EFECTIVO,
    metodoEntrega: MetodoEntrega.TIENDA,
    pagadoConBilletera: new Decimal(0),
    ...cambios,
    total: new Decimal(cambios.total ?? 100),
  } as PedidoDelTurno;
}

describe('productosEntregados', () => {
  const linea = (productoId: string, cantidad: number, importe: number) => ({
    productoId,
    nombre: `Producto ${productoId}`,
    unidad: 'Pz',
    cantidad,
    importe,
  });

  it('suma el mismo producto de varios pedidos entregados', () => {
    const productos = productosEntregados([
      { ...pedido(), items: [linea('b', 2, 20.1), linea('a', 1, 5)] },
      { ...pedido(), items: [linea('b', 3, 30.2)] },
    ]);
    expect(productos.map((p) => p.productoId)).toEqual(['a', 'b']);
    expect(productos[1].cantidad).toBe(5);
    expect(productos[1].importe.toNumber()).toBe(50.3);
  });

  it('deja fuera lo que no se entrego en el mostrador', () => {
    const productos = productosEntregados([
      { ...pedido({ estado: EstadoPedido.CONFIRMADO }), items: [linea('a', 1, 5)] },
      { ...pedido({ metodoEntrega: MetodoEntrega.DOMICILIO }), items: [linea('b', 1, 5)] },
      { ...pedido({ estadoPago: EstadoPago.CANCELADO }), items: [linea('c', 1, 5)] },
      { ...pedido({ estadoPago: EstadoPago.CREDITO }), items: [linea('d', 1, 5)] },
    ]);
    expect(productos.map((p) => p.productoId)).toEqual(['d']);
  });
});

describe('totalesDelTurno', () => {
  it('un turno sin pedidos esta en ceros', () => {
    const t = totalesDelTurno([]);
    expect(t.pedidos).toBe(0);
    expect(t.ventas.toNumber()).toBe(0);
    expect(t.efectivo.toNumber()).toBe(0);
  });

  it('reparte lo cobrado entre efectivo y transferencia', () => {
    const t = totalesDelTurno([
      pedido({ total: 100 }),
      pedido({ total: 50.5 }),
      pedido({ total: 80, metodoPago: MetodoPago.TRANSFERENCIA }),
    ]);
    expect(t.cobrados).toBe(3);
    expect(t.ventas.toNumber()).toBe(230.5);
    expect(t.efectivo.toNumber()).toBe(150.5);
    expect(t.transferencia.toNumber()).toBe(80);
  });

  it('lo pagado con billetera no cuenta como efectivo', () => {
    const t = totalesDelTurno([pedido({ total: 100, pagadoConBilletera: new Decimal(30) })]);
    expect(t.ventas.toNumber()).toBe(100);
    expect(t.billetera.toNumber()).toBe(30);
    expect(t.efectivo.toNumber()).toBe(70);
  });

  it('el pedido sin entregar no suma y se cuenta como pendiente', () => {
    const t = totalesDelTurno([
      pedido({ estado: EstadoPedido.CONFIRMADO, estadoPago: EstadoPago.PAGO_PENDIENTE }),
    ]);
    expect(t.porEntregar).toBe(1);
    expect(t.cobrados).toBe(0);
    expect(t.efectivo.toNumber()).toBe(0);
  });

  it('el pedido a domicilio se cobra en caja aunque Rutas no lo haya entregado', () => {
    const t = totalesDelTurno([
      pedido({ metodoEntrega: MetodoEntrega.DOMICILIO, estado: EstadoPedido.CONFIRMADO }),
    ]);
    expect(t.aDomicilio).toBe(1);
    expect(t.porEntregar).toBe(0);
    expect(t.cobrados).toBe(1);
    expect(t.efectivo.toNumber()).toBe(100);
  });

  it('el pedido a domicilio que quedo pendiente de pago no suma', () => {
    const t = totalesDelTurno([
      pedido({ metodoEntrega: MetodoEntrega.DOMICILIO, estadoPago: EstadoPago.PAGO_PENDIENTE }),
    ]);
    expect(t.aDomicilio).toBe(1);
    expect(t.ventas.toNumber()).toBe(0);
  });

  it('el cancelado ni suma ni queda pendiente', () => {
    const t = totalesDelTurno([
      pedido({ estado: EstadoPedido.CONFIRMADO, estadoPago: EstadoPago.CANCELADO }),
    ]);
    expect(t.cancelados).toBe(1);
    expect(t.porEntregar).toBe(0);
    expect(t.ventas.toNumber()).toBe(0);
  });

  it('el entregado a credito no dejo dinero en caja', () => {
    const t = totalesDelTurno([pedido({ estadoPago: EstadoPago.CREDITO })]);
    expect(t.cobrados).toBe(0);
    expect(t.efectivo.toNumber()).toBe(0);
  });
});
