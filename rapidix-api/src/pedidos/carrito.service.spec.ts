import { ConfiguracionNegocio, MetodoEntrega, Prisma } from '@prisma/client';
import { CarritoService } from './carrito.service';

const D = (n: number) => new Prisma.Decimal(n);

/** Los parametros vigentes del negocio (HU-16). */
const config = {
  costoEnvio: D(30),
  montoEnvioGratis: D(599.99),
  multiplicadorCashback: D(2),
  montoMinimoCashback: D(600),
  incrementoFuera: D(20),
} as ConfiguracionNegocio;

describe('CarritoService.calcularCarrito', () => {
  it('el cashback sale de la base participante, no del subtotal', () => {
    // $1,000 de subtotal, pero solo $700 participan: Bronce 1 % -> $7.
    const desglose = CarritoService.calcularCarrito(
      { subtotal: D(1000), baseCashback: D(700) },
      config,
      true,
      D(1),
    );
    expect(desglose.cashback.toNumber()).toBe(7);
    expect(desglose.cashbackBilletera.toNumber()).toBe(14);
  });

  it('el envio es gratis desde el monto exacto (>=)', () => {
    const gratis = CarritoService.calcularCarrito(
      { subtotal: D(599.99), baseCashback: D(0) },
      config,
      true,
      D(1),
    );
    expect(gratis.envio.toNumber()).toBe(0);

    const cobrado = CarritoService.calcularCarrito(
      { subtotal: D(599.98), baseCashback: D(0) },
      config,
      true,
      D(1),
    );
    expect(cobrado.envio.toNumber()).toBe(30);
  });

  it('recoger en tienda no paga envio ni persigue el envio gratis', () => {
    const tienda = CarritoService.calcularCarrito(
      { subtotal: D(100), baseCashback: D(0) },
      config,
      true,
      D(1),
      D(0),
      D(0),
      MetodoEntrega.TIENDA,
    );
    expect(tienda.envio.toNumber()).toBe(0);
    expect(tienda.total.toNumber()).toBe(100);
    expect(
      CarritoService.metas(D(100), D(0), config, MetodoEntrega.TIENDA).faltaEnvioGratis,
    ).toBeNull();
  });
});

describe('CarritoService: cupon y billetera', () => {
  const base = { subtotal: D(700), baseCashback: D(700) };

  it('el cupon no baja la base del cashback', () => {
    const conCupon = CarritoService.calcularCarrito(base, config, true, D(1), D(100));
    expect(conCupon.total.toNumber()).toBe(600);
    expect(conCupon.cashback.toNumber()).toBe(7);
  });

  it('la billetera reduce lo que se cobra, no el total del pedido', () => {
    const desglose = CarritoService.calcularCarrito(base, config, true, D(1), D(100), D(50));
    expect(desglose.total.toNumber()).toBe(600);
    expect(desglose.billetera.toNumber()).toBe(50);
    expect(desglose.aPagar.toNumber()).toBe(550);
    expect(desglose.cashback.toNumber()).toBe(7);
  });

  it('la billetera nunca deja lo que se cobra por debajo de cero', () => {
    const desglose = CarritoService.calcularCarrito(base, config, true, D(1), D(0), D(9999));
    expect(desglose.billetera.toNumber()).toBe(700);
    expect(desglose.aPagar.toNumber()).toBe(0);
  });
});

describe('CarritoService.validarBilletera', () => {
  it('acepta lo que cabe en el saldo y en el total', () => {
    const r = CarritoService.validarBilletera(D(40), D(50), D(100));
    expect(r.monto.toNumber()).toBe(40);
    expect(r.error).toBeNull();
  });

  it('no deja pasar del saldo', () => {
    const r = CarritoService.validarBilletera(D(80), D(50), D(100));
    expect(r.error?.codigo).toBe('BILLETERA_INSUFICIENTE');
    expect(r.monto.toNumber()).toBe(50);
  });

  it('no deja pasar del total despues del cupon', () => {
    const r = CarritoService.validarBilletera(D(80), D(200), D(60));
    expect(r.error?.codigo).toBe('BILLETERA_EXCEDE_TOTAL');
    expect(r.monto.toNumber()).toBe(60);
  });
});

describe('CarritoService.evaluarPago', () => {
  it('pide un metodo mientras haya algo que cobrar', () => {
    expect(CarritoService.evaluarPago(undefined, undefined, D(10)).error?.codigo).toBe(
      'METODO_REQUERIDO',
    );
  });

  it('no pide nada si la billetera cubre el pedido', () => {
    expect(CarritoService.evaluarPago(undefined, undefined, D(0)).error).toBeNull();
  });

  it('en efectivo calcula el cambio', () => {
    const r = CarritoService.evaluarPago('EFECTIVO', 200, D(173.99));
    expect(r.error).toBeNull();
    expect(r.cambio?.toNumber()).toBe(26.01);
  });

  it('en efectivo rechaza un monto menor al total', () => {
    expect(CarritoService.evaluarPago('EFECTIVO', 100, D(173.99)).error?.codigo).toBe(
      'PAGO_INSUFICIENTE',
    );
  });

  it('en efectivo exige el monto', () => {
    expect(CarritoService.evaluarPago('EFECTIVO', undefined, D(10)).error?.codigo).toBe(
      'PAGO_CON_REQUERIDO',
    );
  });

  it('la transferencia no pide monto', () => {
    expect(CarritoService.evaluarPago('TRANSFERENCIA', undefined, D(10)).error).toBeNull();
  });
});

describe('CarritoService.metas', () => {
  it('dice cuanto falta para el envio gratis', () => {
    const metas = CarritoService.metas(D(500), D(500), config);
    expect(metas.faltaEnvioGratis).toBeCloseTo(99.99);
  });

  it('no avisa del cashback antes del 80 % del minimo', () => {
    expect(CarritoService.metas(D(470), D(470), config).faltaCashback).toBeNull();
  });

  it('avisa del cashback a partir del 80 % del minimo', () => {
    expect(CarritoService.metas(D(480), D(480), config).faltaCashback).toBe(120);
  });

  it('con la base justo en el minimo todavia falta un centavo', () => {
    expect(CarritoService.metas(D(600), D(600), config).faltaCashback).toBe(0.01);
  });

  it('ya no avisa cuando el cashback esta activo', () => {
    expect(CarritoService.metas(D(700), D(700), config).faltaCashback).toBeNull();
  });

  it('marca el carrito sin productos participantes', () => {
    const metas = CarritoService.metas(D(300), D(0), config);
    expect(metas.sinCashback).toBe(true);
    expect(metas.faltaCashback).toBeNull();
  });
});
