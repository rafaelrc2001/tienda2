import { Prisma } from '@prisma/client';
import { pagadoDelPedido, pagoCabe, PedidoPorCobrar, saldoDelPedido } from './cxc';

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
