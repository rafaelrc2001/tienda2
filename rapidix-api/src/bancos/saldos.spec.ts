import { Prisma } from '@prisma/client';
import { claveMes, diaDentroDelMes, encadenarSaldos, mesSiguiente } from './saldos';

const D = (valor: number | string) => new Prisma.Decimal(valor);

describe('mesSiguiente', () => {
  it('pasa al mes de al lado', () => {
    expect(mesSiguiente({ anio: 2026, mes: 9 })).toEqual({ anio: 2026, mes: 10 });
  });

  it('después de diciembre viene enero del año siguiente', () => {
    expect(mesSiguiente({ anio: 2026, mes: 12 })).toEqual({ anio: 2027, mes: 1 });
  });
});

describe('claveMes', () => {
  it('enero del año siguiente va después de diciembre', () => {
    expect(claveMes({ anio: 2027, mes: 1 })).toBeGreaterThan(claveMes({ anio: 2026, mes: 12 }));
  });
});

describe('diaDentroDelMes', () => {
  const septiembre = { anio: 2026, mes: 9 };

  it('acepta el primero y el último día del mes', () => {
    expect(diaDentroDelMes('2026-09-01', septiembre)).toBe(true);
    expect(diaDentroDelMes('2026-09-30', septiembre)).toBe(true);
  });

  it('rechaza un día de otro mes o de otro año', () => {
    expect(diaDentroDelMes('2026-10-01', septiembre)).toBe(false);
    expect(diaDentroDelMes('2025-09-15', septiembre)).toBe(false);
  });

  it('rechaza un día que no existe', () => {
    expect(diaDentroDelMes('2026-09-31', septiembre)).toBe(false);
    expect(diaDentroDelMes('2026-02-29', { anio: 2026, mes: 2 })).toBe(false);
  });
});

describe('encadenarSaldos', () => {
  it('el primero empieza en su apertura y cada uno sigue donde acabó el anterior', () => {
    const periodos = [
      { id: 'oct', anio: 2026, mes: 10, saldoApertura: null },
      { id: 'sep', anio: 2026, mes: 9, saldoApertura: D('10.10') },
      { id: 'nov', anio: 2026, mes: 11, saldoApertura: null },
    ];
    const sumas = new Map([
      ['sep', D('62714.95')],
      ['oct', D('-4451.05')],
    ]);

    const saldos = encadenarSaldos(periodos, sumas);

    expect(saldos.get('sep')?.inicial.toFixed(2)).toBe('10.10');
    expect(saldos.get('sep')?.final.toFixed(2)).toBe('62725.05');
    expect(saldos.get('oct')?.inicial.toFixed(2)).toBe('62725.05');
    expect(saldos.get('oct')?.final.toFixed(2)).toBe('58274.00');
    // Un mes sin movimientos se queda como empezo.
    expect(saldos.get('nov')?.inicial.toFixed(2)).toBe('58274.00');
    expect(saldos.get('nov')?.final.toFixed(2)).toBe('58274.00');
  });

  it('el saldo puede quedar en negativo', () => {
    const saldos = encadenarSaldos(
      [{ id: 'a', anio: 2026, mes: 1, saldoApertura: D(100) }],
      new Map([['a', D(-250)]]),
    );
    expect(saldos.get('a')?.final.toFixed(2)).toBe('-150.00');
  });
});
