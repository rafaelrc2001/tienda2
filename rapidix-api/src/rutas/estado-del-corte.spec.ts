import { EstadoCorte, Prisma } from '@prisma/client';
import {
  abonoPendiente,
  adeudoDelCorte,
  CorteEnCuenta,
  estadoTrasAceptar,
} from './estado-del-corte';

const D = (n: number | string) => new Prisma.Decimal(n);
const HOY = new Date('2026-10-01T18:00:00Z');

const aceptado = (monto: number) => ({ monto: D(monto), aceptadoEn: HOY });
const pendiente = (monto: number) => ({ monto: D(monto), aceptadoEn: null });

/** Un corte de $500 calculados, con el dinero y la entrega aceptados salvo que se diga otra cosa. */
const corte = (cambios: Partial<CorteEnCuenta> = {}): CorteEnCuenta => ({
  montoCalculado: D(500),
  montoRecibido: D(500),
  entregaAceptadaEn: HOY,
  abonos: [],
  ...cambios,
});

describe('adeudoDelCorte', () => {
  it('sin dinero aceptado todavía no hay adeudo', () => {
    expect(adeudoDelCorte(corte({ montoRecibido: null })).toNumber()).toBe(0);
  });

  it('es lo calculado menos lo aceptado', () => {
    expect(adeudoDelCorte(corte({ montoRecibido: D(400) })).toNumber()).toBe(100);
  });

  it('resta los abonos aceptados', () => {
    expect(
      adeudoDelCorte(corte({ montoRecibido: D(400), abonos: [aceptado(60)] })).toNumber(),
    ).toBe(40);
  });

  it('un abono pendiente no cuenta: ese dinero sigue en la bolsa del repartidor', () => {
    expect(
      adeudoDelCorte(corte({ montoRecibido: D(400), abonos: [pendiente(60)] })).toNumber(),
    ).toBe(100);
  });

  it('medio centavo o menos ya está saldado', () => {
    expect(adeudoDelCorte(corte({ montoRecibido: D('499.996') })).toNumber()).toBe(0);
  });

  it('entregar de más no deja saldo a favor', () => {
    expect(adeudoDelCorte(corte({ montoRecibido: D(620) })).toNumber()).toBe(0);
  });
});

describe('abonoPendiente', () => {
  it('es el que no se ha aceptado, o ninguno', () => {
    expect(abonoPendiente([aceptado(10), pendiente(20)])?.monto.toNumber()).toBe(20);
    expect(abonoPendiente([aceptado(10)])).toBeNull();
    expect(abonoPendiente([])).toBeNull();
  });
});

describe('estadoTrasAceptar', () => {
  it('sin «Entrega aceptada» sigue liquidado, aunque el dinero ya esté aceptado', () => {
    expect(estadoTrasAceptar(corte({ entregaAceptadaEn: null }))).toBe(EstadoCorte.LIQUIDADO);
    expect(estadoTrasAceptar(corte({ entregaAceptadaEn: null, montoRecibido: null }))).toBe(
      EstadoCorte.LIQUIDADO,
    );
  });

  it('entrega aceptada sin adeudo: cerrado', () => {
    expect(estadoTrasAceptar(corte())).toBe(EstadoCorte.CERRADO);
  });

  it('entrega aceptada con adeudo: aceptado', () => {
    expect(estadoTrasAceptar(corte({ montoRecibido: D(400) }))).toBe(EstadoCorte.ACEPTADO);
  });

  it('un abono pendiente lo regresa a liquidado', () => {
    expect(estadoTrasAceptar(corte({ montoRecibido: D(400), abonos: [pendiente(60)] }))).toBe(
      EstadoCorte.LIQUIDADO,
    );
  });

  it('al aceptar un abono que no cubre todo, vuelve a aceptado', () => {
    expect(estadoTrasAceptar(corte({ montoRecibido: D(400), abonos: [aceptado(60)] }))).toBe(
      EstadoCorte.ACEPTADO,
    );
  });

  it('al aceptar el abono que cubre el adeudo queda cerrado, sin más pasos', () => {
    expect(
      estadoTrasAceptar(corte({ montoRecibido: D(400), abonos: [aceptado(60), aceptado(40)] })),
    ).toBe(EstadoCorte.CERRADO);
  });

  it('el abono pendiente manda aunque fuera a saldar el adeudo', () => {
    expect(estadoTrasAceptar(corte({ montoRecibido: D(400), abonos: [pendiente(100)] }))).toBe(
      EstadoCorte.LIQUIDADO,
    );
  });

  it('cancelar el abono pendiente lo devuelve a aceptado', () => {
    expect(estadoTrasAceptar(corte({ montoRecibido: D(400), abonos: [] }))).toBe(
      EstadoCorte.ACEPTADO,
    );
  });
});
