import { Prisma } from '@prisma/client';
import { CashbackService } from './cashback.service';

const D = (n: number) => new Prisma.Decimal(n);

describe('CashbackService.calcular', () => {
  it('trunca a pesos enteros: Plata sobre $1,250 son $18', () => {
    expect(CashbackService.calcular(D(1250), D(1.5), D(600)).toNumber()).toBe(18);
  });

  it('con la base justo en el minimo no hay cashback', () => {
    expect(CashbackService.calcular(D(600), D(1), D(600)).toNumber()).toBe(0);
  });

  it('un centavo por encima del minimo ya cuenta', () => {
    expect(CashbackService.calcular(D(600.01), D(1.5), D(600)).toNumber()).toBe(9);
  });

  it('suma el bono manual como puntos porcentuales', () => {
    // Bronce 1 % + 0.5 de bono sobre $1,000.
    expect(CashbackService.calcular(D(1000), D(1).add(0.5), D(600)).toNumber()).toBe(15);
  });
});

describe('CashbackService.aBilletera', () => {
  it('multiplica la base por las veces que vale en billetera', () => {
    expect(CashbackService.aBilletera(D(18), D(2)).toNumber()).toBe(36);
  });
});
