import { EstadoPago, MetodoPago, Prisma } from '@prisma/client';
import {
  ajusteDeEntrega,
  CargaLiquidable,
  cobradoDelRenglon,
  cuentaDeLaEntrega,
  destinoAlAceptar,
  DestinoDelPedido,
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

describe('ajusteDeEntrega', () => {
  const total = (pedido: PedidoALiquidar, cargas: CargaLiquidable[]) =>
    ajusteDeEntrega(pedido, cargas).total.toNumber();

  it('entrega completa: el pedido no cambia', () => {
    const ajuste = ajusteDeEntrega(enEfectivo, [diezPiezas]);
    expect(ajuste.total.toNumber()).toBe(300);
    expect(ajuste.noEntregado.toNumber()).toBe(0);
    expect(ajuste.billeteraDevuelta.toNumber()).toBe(0);
  });

  it('el caso de la pantalla: $78 + $20 de envío y deja 1 de 2 leches de $24', () => {
    const leche: CargaLiquidable = {
      cantidadCargada: 2,
      cantidadEntregada: 1,
      precioUnitario: D(24),
      precioEntregado: null,
    };
    expect(total({ ...enEfectivo, total: D(98) }, [leche])).toBe(74);
  });

  it('lo que el cliente no aceptó sale del total', () => {
    // Acepta 8 de 10 y sigue en el mismo escalón: se descuentan 2 x $17.
    const ocho: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 8 };
    expect(total(enEfectivo, [ocho])).toBe(300 - 34);
  });

  it('una parcial vale al precio re-cotizado, no al del pedido', () => {
    // Acepta 4: pierde el volumen y cada pieza pasa a $19.95. Vale
    // 4 x 19.95 = 79.80 de los 170 que cotizaba el renglón.
    const cuatro: CargaLiquidable = {
      ...diezPiezas,
      cantidadEntregada: 4,
      precioEntregado: D(19.95),
    };
    expect(total(enEfectivo, [cuatro])).toBe(300 - 170 + 79.8);
  });

  it('el envío y el descuento no se tocan aunque se devuelva todo', () => {
    // Pedido de $170 de mercancía + $30 de envío = $200. No acepta nada:
    // queda el envío, porque el viaje se hizo.
    const nada: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 0 };
    expect(total({ ...enEfectivo, total: D(200) }, [nada])).toBe(30);
  });

  it('nunca baja de cero', () => {
    // El cupón dejó el total por debajo del valor de la mercancía.
    const nada: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 0 };
    expect(total({ ...enEfectivo, total: D(100) }, [nada])).toBe(0);
  });

  it('suma todos los renglones del pedido', () => {
    const otro: CargaLiquidable = {
      cantidadCargada: 2,
      cantidadEntregada: 1,
      precioUnitario: D(45),
      precioEntregado: null,
    };
    expect(total(enEfectivo, [diezPiezas, otro])).toBe(300 - 45);
  });

  it('trabaja con decimales sin arrastrar el error del binario', () => {
    const carga: CargaLiquidable = {
      cantidadCargada: 3,
      cantidadEntregada: 2,
      precioUnitario: D(8.1),
      precioEntregado: null,
    };
    expect(total({ ...enEfectivo, total: D(26.5) }, [carga])).toBe(18.4);
  });

  it('la billetera que ya no hace falta vuelve al cliente', () => {
    // Pagó $250 con billetera y el pedido baja a $130: le vuelven $120.
    const nada: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 0 };
    const ajuste = ajusteDeEntrega({ ...enEfectivo, pagadoConBilletera: D(250) }, [nada]);
    expect(ajuste.total.toNumber()).toBe(130);
    expect(ajuste.pagadoConBilletera.toNumber()).toBe(130);
    expect(ajuste.billeteraDevuelta.toNumber()).toBe(120);
  });
});

describe('efectivoDelPedido', () => {
  it('trae el total del pedido, que ya es lo que se entregó', () => {
    expect(efectivoDelPedido(enEfectivo).toNumber()).toBe(300);
  });

  it('descuenta el saldo de billetera que el cliente ya había pagado', () => {
    const conBilletera = { ...enEfectivo, pagadoConBilletera: D(50) };
    expect(efectivoDelPedido(conBilletera).toNumber()).toBe(250);
  });

  it('un pedido a crédito no trae nada', () => {
    const credito = { ...enEfectivo, estadoPago: EstadoPago.CREDITO };
    expect(efectivoDelPedido(credito).toNumber()).toBe(0);
  });

  it('a crédito trae solo lo que el cliente abonó en la puerta', () => {
    const credito = { ...enEfectivo, estadoPago: EstadoPago.CREDITO, abonoEnPuerta: D(120) };
    expect(efectivoDelPedido(credito).toNumber()).toBe(120);
  });

  it('el abono lo sigue trayendo aunque el pedido se marque pagado después', () => {
    const pagado = { ...enEfectivo, estadoPago: EstadoPago.PAGADO, abonoEnPuerta: D(120) };
    expect(efectivoDelPedido(pagado).toNumber()).toBe(120);
  });
});

describe('destinoAlAceptar', () => {
  it('el efectivo cobrado en la puerta queda pagado', () => {
    expect(destinoAlAceptar(enEfectivo)).toBe(DestinoDelPedido.PAGADO);
  });

  it('el crédito con saldo es una cuenta por cobrar', () => {
    expect(destinoAlAceptar({ ...enEfectivo, estadoPago: EstadoPago.CREDITO })).toBe(
      DestinoDelPedido.CXC,
    );
  });

  it('el crédito en transferencia también: lo que cuenta es que debe', () => {
    expect(
      destinoAlAceptar({
        ...enEfectivo,
        metodoPago: MetodoPago.TRANSFERENCIA,
        estadoPago: EstadoPago.CREDITO,
      }),
    ).toBe(DestinoDelPedido.CXC);
  });

  it('el crédito con un abono en la puerta sigue siendo cuenta por cobrar por el resto', () => {
    expect(
      destinoAlAceptar({ ...enEfectivo, estadoPago: EstadoPago.CREDITO, abonoEnPuerta: D(100) }),
    ).toBe(DestinoDelPedido.CXC);
  });

  it('el crédito que el abono en la puerta cubrió entero queda pagado', () => {
    expect(
      destinoAlAceptar({ ...enEfectivo, estadoPago: EstadoPago.CREDITO, abonoEnPuerta: D(300) }),
    ).toBe(DestinoDelPedido.PAGADO);
  });

  it('el crédito cubierto entero con la billetera no debe nada', () => {
    expect(
      destinoAlAceptar({
        ...enEfectivo,
        estadoPago: EstadoPago.CREDITO,
        pagadoConBilletera: D(300),
      }),
    ).toBeNull();
  });

  it.each([EstadoPago.PAGADO, EstadoPago.REEMBOLSADO, EstadoPago.CANCELADO, EstadoPago.RETENER])(
    'un pedido en %s se queda como está',
    (estadoPago) => {
      expect(destinoAlAceptar({ ...enEfectivo, estadoPago })).toBeNull();
    },
  );

  it('una transferencia pendiente no la trae el repartidor: no se paga sola', () => {
    expect(destinoAlAceptar({ ...enEfectivo, metodoPago: MetodoPago.TRANSFERENCIA })).toBeNull();
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
    // Lo mismo que leerá el corte del pedido ya ajustado.
    const ajustado = { ...enEfectivo, ...ajusteDeEntrega(enEfectivo, [ocho]) };
    expect(cuenta.aCobrar.toNumber()).toBe(efectivoDelPedido(ajustado).toNumber());
    expect(cuenta.aCobrar.toNumber()).toBe(266);
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
    expect(cuenta.saldoCredito).toBeNull();
  });

  describe('a crédito', () => {
    const credito = { ...enEfectivo, estadoPago: EstadoPago.CREDITO };

    it('no cobra nada y se entrega sin abono', () => {
      const cuenta = cuentaDeLaEntrega(credito, [diezPiezas], null);
      expect(cuenta.aCobrar.toNumber()).toBe(0);
      expect(cuenta.cubre).toBe(true);
      expect(cuenta.saldoCredito?.toNumber()).toBe(300);
    });

    it('acepta un abono de hasta lo que debe, sin cambio', () => {
      expect(cuentaDeLaEntrega(credito, [diezPiezas], D(100))).toMatchObject({
        cubre: true,
        cambio: null,
      });
      expect(cuentaDeLaEntrega(credito, [diezPiezas], D(300)).cubre).toBe(true);
    });

    it('un abono mayor que lo que debe no cabe', () => {
      expect(cuentaDeLaEntrega(credito, [diezPiezas], D(300.01)).cubre).toBe(false);
    });

    it('el tope es lo que debe del pedido ya como se entregó', () => {
      const ocho: CargaLiquidable = { ...diezPiezas, cantidadEntregada: 8 };
      const cuenta = cuentaDeLaEntrega(credito, [ocho], D(266));
      expect(cuenta.saldoCredito?.toNumber()).toBe(266);
      expect(cuenta.cubre).toBe(true);
      expect(cuentaDeLaEntrega(credito, [ocho], D(267)).cubre).toBe(false);
    });
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
