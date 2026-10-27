import { Prisma } from '@prisma/client';
import { pagadoDelPedido, pagoCabe, PedidoPorCobrar, saldoDelPedido, vencimiento } from './cxc';

const D = (n: number | string) => new Prisma.Decimal(n);

/** Un crédito de $300 del que la billetera cubrió $50: debe $250. */
const pedido = (cambios: Partial<PedidoPorCobrar> = {}): PedidoPorCobrar => ({
  total: D(300),
  pagadoConBilletera: D(50),
  pagos: [],
  ...cambios,
});

describe('saldoDelPedido', () => {
  it('sin pagos es el total menos lo que cubrió la billetera', () => {
    expect(saldoDelPedido(pedido()).toNumber()).toBe(250);
  });

  it('cada pago lo baja', () => {
    expect(saldoDelPedido(pedido({ pagos: [{ monto: D(100) }] })).toNumber()).toBe(150);
    expect(
      saldoDelPedido(pedido({ pagos: [{ monto: D(100) }, { monto: D(150) }] })).toNumber(),
    ).toBe(0);
  });

  it('sin billetera es el total entero', () => {
    expect(saldoDelPedido(pedido({ pagadoConBilletera: D(0) })).toNumber()).toBe(300);
  });

  it('cubierto entero con la billetera no debe nada', () => {
    expect(saldoDelPedido(pedido({ pagadoConBilletera: D(300) })).toNumber()).toBe(0);
  });

  it('medio centavo o menos ya está saldado', () => {
    expect(saldoDelPedido(pedido({ pagos: [{ monto: D('249.996') }] })).toNumber()).toBe(0);
  });

  it('pagar de más no deja saldo a favor', () => {
    expect(saldoDelPedido(pedido({ pagos: [{ monto: D(400) }] })).toNumber()).toBe(0);
  });
});

describe('pagadoDelPedido', () => {
  it('suma los pagos, sin la billetera', () => {
    expect(
      pagadoDelPedido(pedido({ pagos: [{ monto: D(100) }, { monto: D(25.5) }] })).toNumber(),
    ).toBe(125.5);
    expect(pagadoDelPedido(pedido()).toNumber()).toBe(0);
  });
});

describe('pagoCabe', () => {
  it('cabe hasta el saldo exacto', () => {
    expect(pagoCabe(pedido(), D(100))).toBe(true);
    expect(pagoCabe(pedido(), D(250))).toBe(true);
  });

  it('no cabe un centavo más', () => {
    expect(pagoCabe(pedido(), D('250.01'))).toBe(false);
  });

  it('no cabe nada en un pedido ya saldado', () => {
    expect(pagoCabe(pedido({ pagos: [{ monto: D(250) }] }), D(1))).toBe(false);
  });
});

describe('vencimiento', () => {
  // Entregado el 21 con 5 dias: vence el 26.
  const del21 = (hoy: string) => vencimiento('2026-10-21', 5, hoy);

  it('vence el dia de entrega mas los dias de credito', () => {
    expect(del21('2026-10-21')?.vence).toBe('2026-10-26');
  });

  it('antes de vencer cuenta los dias que le quedan', () => {
    expect(del21('2026-10-21')?.dias).toBe(5);
    expect(del21('2026-10-25')?.dias).toBe(1);
  });

  it('el dia que vence va en 0', () => {
    expect(del21('2026-10-26')?.dias).toBe(0);
  });

  it('despues cuenta en negativo los dias vencida', () => {
    expect(del21('2026-10-27')?.dias).toBe(-1);
    expect(del21('2026-10-29')?.dias).toBe(-3);
  });

  it('cruza de mes', () => {
    expect(vencimiento('2026-10-30', 5, '2026-11-04')).toEqual({ vence: '2026-11-04', dias: 0 });
  });

  it('sin plazo no vence', () => {
    expect(vencimiento('2026-10-21', null, '2026-10-30')).toBeNull();
  });
});
