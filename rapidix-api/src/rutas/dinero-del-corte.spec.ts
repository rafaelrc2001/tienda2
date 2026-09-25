import { EstadoPago, MetodoPago, Prisma } from '@prisma/client';
import {
  CargaLiquidable,
  cobradoDelRenglon,
  cuentaDeLaEntrega,
  devueltoDelRenglon,
  efectivoDelPedido,
  PedidoALiquidar,
  traeEfectivo,
} from './dinero-del-corte';

const D = (n: number) => new Prisma.Decimal(n);

/** Efectivo contra entrega con el pago pendiente: el caso de todos los días. */
const enEfectivo: PedidoALiquidar = {
  metodoPago: MetodoPago.EFECTIVO,
  estadoPago: EstadoPago.PAGO_PENDIENTE,
  total: D(300),
  pagadoConBilletera: D(0),
};

/** 10 piezas a $17 (precio por volumen): el pedido cotizó $170 de mercancía. */
const diezPiezas: CargaLiquidable = {
  cantidadCargada: 10,
  cantidadEntregada: 10,
  precioUnitario: D(17),
  precioEntregado: null,
};

describe('traeEfectivo', () => {
  it.each([
    [EstadoPago.PAGO_PENDIENTE, true],
    [EstadoPago.RETENER, false],
    [EstadoPago.CREDITO, false],
    [EstadoPago.PAGADO, false],
    [EstadoPago.REEMBOLSADO, false],
    [EstadoPago.CANCELADO, false],
  ])('en efectivo y %s: %s', (estadoPago, esperado) => {
    expect(traeEfectivo({ ...enEfectivo, estadoPago })).toBe(esperado);
  });

  it('una transferencia nunca pasa por sus manos', () => {
    expect(traeEfectivo({ ...enEfectivo, metodoPago: MetodoPago.TRANSFERENCIA })).toBe(false);
  });
});

describe('efectivoDelPedido', () => {
  it('entrega completa: trae lo que el pedido iba a cobrar', () => {
    expect(efectivoDelPedido(enEfectivo, [diezPiezas]).toNumber()).toBe(300);
  });

  it('descuenta el saldo de billetera que el cliente ya había pagado', () => {
    const conBilletera = { ...enEfectivo, pagadoConBilletera: D(50) };
    expect(efectivoDelPedido(conBilletera, [diezPiezas]).toNumber()).toBe(250);
  });

  it('lo que el cliente no aceptó no se cobra', () => {
    // Acepta 8 de 10 y sigue en el mismo escalón: se descuentan 2 x $17.
    const ocho: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 8 };
    expect(efectivoDelPedido(enEfectivo, [ocho]).toNumber()).toBe(300 - 34);
  });

  it('una parcial cobra el precio re-cotizado, no el del pedido', () => {
    // Acepta 4: pierde el volumen y cada pieza pasa a $19.95. Se cobran
    // 4 x 19.95 = 79.80 de los 170 que cotizaba el renglón.
    const cuatro: CargaLiquidable = {
      ...diezPiezas,
      cantidadEntregada: 4,
      precioEntregado: D(19.95),
    };
    expect(efectivoDelPedido(enEfectivo, [cuatro]).toNumber()).toBe(300 - 170 + 79.8);
  });

  it('el envío y el descuento no se tocan aunque se devuelva todo', () => {
    // Pedido de $170 de mercancía + $30 de envío = $200. No acepta nada:
    // queda el envío, porque el viaje se hizo.
    const soloEnvio = { ...enEfectivo, total: D(200) };
    const nada: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 0 };
    expect(efectivoDelPedido(soloEnvio, [nada]).toNumber()).toBe(30);
  });

  it('nunca baja de cero: una devolución grande no vuelve acreedor al repartidor', () => {
    // El cupón dejó el total por debajo del valor de la mercancía.
    const conCupon = { ...enEfectivo, total: D(100) };
    const nada: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 0 };
    expect(efectivoDelPedido(conCupon, [nada]).toNumber()).toBe(0);
  });

  it('suma todos los renglones del pedido', () => {
    const otro: CargaLiquidable = {
      cantidadCargada: 2,
      cantidadEntregada: 1,
      precioUnitario: D(45),
      precioEntregado: null,
    };
    expect(efectivoDelPedido(enEfectivo, [diezPiezas, otro]).toNumber()).toBe(300 - 45);
  });

  it('un pedido a crédito no trae nada, aunque se haya entregado entero', () => {
    const credito = { ...enEfectivo, estadoPago: EstadoPago.CREDITO };
    expect(efectivoDelPedido(credito, [diezPiezas]).toNumber()).toBe(0);
  });

  it('trabaja con decimales sin arrastrar el error del binario', () => {
    const centavos = { ...enEfectivo, total: D(26.5) };
    const carga: CargaLiquidable = {
      cantidadCargada: 3,
      cantidadEntregada: 2,
      precioUnitario: D(8.1),
      precioEntregado: null,
    };
    expect(efectivoDelPedido(centavos, [carga]).toNumber()).toBe(18.4);
  });
});

describe('cobradoDelRenglon', () => {
  it('sin re-cotizar manda el precio del pedido', () => {
    expect(cobradoDelRenglon(diezPiezas).toNumber()).toBe(170);
  });

  it('re-cotizado manda el precio nuevo', () => {
    const parcial = { ...diezPiezas, cantidadEntregada: 4, precioEntregado: D(19.95) };
    expect(cobradoDelRenglon(parcial).toNumber()).toBe(79.8);
  });
});

describe('cuentaDeLaEntrega', () => {
  it('pide lo mismo que el corte y da el cambio', () => {
    const ocho: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 8 };
    const cuenta = cuentaDeLaEntrega(enEfectivo, [ocho], D(300));
    expect(cuenta.productos.toNumber()).toBe(136);
    expect(cuenta.aCobrar.toNumber()).toBe(efectivoDelPedido(enEfectivo, [ocho]).toNumber());
    expect(cuenta.cambio?.toNumber()).toBe(34);
    expect(cuenta.cubre).toBe(true);
  });

  it('sin pago recibido, o corto, no cubre ni da cambio', () => {
    expect(cuentaDeLaEntrega(enEfectivo, [diezPiezas], null)).toMatchObject({
      cambio: null,
      cubre: false,
    });
    expect(cuentaDeLaEntrega(enEfectivo, [diezPiezas], D(299.99)).cubre).toBe(false);
  });

  it('el pago exacto cubre con cambio cero', () => {
    const cuenta = cuentaDeLaEntrega(enEfectivo, [diezPiezas], D(300));
    expect(cuenta.cubre).toBe(true);
    expect(cuenta.cambio?.toNumber()).toBe(0);
  });

  it('sin efectivo que cobrar siempre cubre', () => {
    const transferencia = { ...enEfectivo, metodoPago: MetodoPago.TRANSFERENCIA };
    const cuenta = cuentaDeLaEntrega(transferencia, [diezPiezas], null);
    expect(cuenta.aCobrar.toNumber()).toBe(0);
    expect(cuenta.cubre).toBe(true);
  });
});

describe('devueltoDelRenglon', () => {
  it.each([
    [10, 0],
    [4, 6],
    [0, 10],
  ])('aceptadas %i, devuelve %i', (cantidadEntregada, esperado) => {
    expect(devueltoDelRenglon({ ...diezPiezas, cantidadEntregada })).toBe(esperado);
  });
});
