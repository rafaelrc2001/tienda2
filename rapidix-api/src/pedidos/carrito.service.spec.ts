import { ConfiguracionNegocio, Prisma } from '@prisma/client';
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
