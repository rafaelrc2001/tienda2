import { EstadoPago, EstadoPedido, MetodoEntrega, MetodoPago, Prisma } from '@prisma/client';
import { PedidoDelTurno, totalesDelTurno } from './corte-de-caja';

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

  it('el pedido a domicilio no pasa por la caja aunque ya este pagado', () => {
    const t = totalesDelTurno([pedido({ metodoEntrega: MetodoEntrega.DOMICILIO })]);
    expect(t.aDomicilio).toBe(1);
    expect(t.porEntregar).toBe(0);
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
