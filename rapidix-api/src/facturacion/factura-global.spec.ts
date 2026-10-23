import { MetodoPago, Prisma, TasaIva } from '@prisma/client';
import {
  armarFacturaGlobal,
  formaDePagoGlobal,
  mesesCompatibles,
  RenglonGlobal,
  repartirTotal,
} from './factura-global';

const D = (n: number | string) => new Prisma.Decimal(n);

const renglon = (r: Partial<RenglonGlobal> & { cantidad: number }): RenglonGlobal => ({
  descripcion: r.descripcion ?? 'Venta global - Producto',
  claveProdServ: r.claveProdServ ?? '01010101',
  claveUnidad: r.claveUnidad ?? 'H87',
  unidad: r.unidad ?? 'Pieza',
  cantidad: r.cantidad,
  tasa: r.tasa ?? TasaIva.DIECISEIS,
  peso: r.peso ?? D(r.cantidad),
});

/** Lo que valida el SAT: cada IVA es su base al 16 % redondeada, y todo suma el total. */
function exigirCuadre(total: string, renglones: RenglonGlobal[]): void {
  const armada = armarFacturaGlobal(D(total), renglones);
  if ('error' in armada) throw new Error(`${total}: ${armada.error}`);
  expect(armada.subtotal.add(armada.iva).toFixed(2)).toBe(total);
  for (const c of armada.conceptos) {
    expect(c.base.greaterThan(0)).toBe(true);
    expect(c.importe.equals(c.base)).toBe(true);
    const tasa = c.tasa === TasaIva.DIECISEIS ? D('0.16') : D(0);
    expect(c.iva.equals(c.base.mul(tasa).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP))).toBe(
      true,
    );
    // El precio unitario por la cantidad vuelve al importe (a centavos).
    expect(c.valorUnitario.mul(c.cantidad).toDecimalPlaces(2).equals(c.importe)).toBe(true);
  }
}

describe('repartirTotal', () => {
  it('reparte en proporcion y el ultimo se lleva el redondeo', () => {
    expect(repartirTotal(D('10'), [D(1), D(1), D(1)]).map((p) => p.toFixed(2))).toEqual([
      '3.33',
      '3.33',
      '3.34',
    ]);
  });

  it('con un peso en cero reparte por partes iguales', () => {
    expect(repartirTotal(D('10'), [D(0), D(3)]).map((p) => p.toFixed(2))).toEqual(['5.00', '5.00']);
  });
});

describe('armarFacturaGlobal', () => {
  it('el ejemplo: $100.99 con 6 y 4 piezas al 16 % da el total exacto', () => {
    exigirCuadre('100.99', [renglon({ cantidad: 6 }), renglon({ cantidad: 4 })]);
  });

  it('respeta el peso del precio de lista', () => {
    const armada = armarFacturaGlobal(D('300'), [
      renglon({ cantidad: 1, peso: D(100), tasa: TasaIva.CERO }),
      renglon({ cantidad: 1, peso: D(200), tasa: TasaIva.CERO }),
    ]);
    if ('error' in armada) throw new Error(armada.error);
    expect(armada.conceptos.map((c) => c.importe.toFixed(2))).toEqual(['100.00', '200.00']);
    expect(armada.iva.toFixed(2)).toBe('0.00');
  });

  it('un producto al 0 % absorbe el centavo que el del 16 % no alcanza', () => {
    exigirCuadre('7.00', [renglon({ cantidad: 1 }), renglon({ cantidad: 1, tasa: TasaIva.CERO })]);
  });

  it('con un solo producto al 16 % hay totales a los que no se llega', () => {
    expect(armarFacturaGlobal(D('7.00'), [renglon({ cantidad: 3 })])).toEqual({
      error: 'NO_CUADRA',
    });
    exigirCuadre('7.01', [renglon({ cantidad: 3 })]);
  });

  it('un total que no alcanza un centavo por renglon no se arma', () => {
    expect(
      armarFacturaGlobal(D('0.01'), [renglon({ cantidad: 1 }), renglon({ cantidad: 1 })]),
    ).toEqual({ error: 'MONTO_INSUFICIENTE' });
  });

  it('cuadra al centavo cualquier total con dos o mas productos al 16 %', () => {
    const combinaciones = [
      [renglon({ cantidad: 6 }), renglon({ cantidad: 4 })],
      [renglon({ cantidad: 1, peso: D(35) }), renglon({ cantidad: 12, peso: D(240) })],
      [renglon({ cantidad: 2 }), renglon({ cantidad: 7 }), renglon({ cantidad: 1.5 })],
    ];
    for (let centavos = 50; centavos <= 20_000; centavos += 37) {
      const total = (centavos / 100).toFixed(2);
      for (const renglones of combinaciones) exigirCuadre(total, renglones);
    }
  });

  it('cuadra mezclando tasas', () => {
    for (let centavos = 10; centavos <= 5_000; centavos += 13) {
      exigirCuadre((centavos / 100).toFixed(2), [
        renglon({ cantidad: 3, peso: D(60) }),
        renglon({ cantidad: 2, peso: D(25), tasa: TasaIva.CERO }),
      ]);
    }
  });
});

describe('formaDePagoGlobal', () => {
  it('es la del deposito de mayor monto', () => {
    expect(
      formaDePagoGlobal([
        { cantidad: D(50), metodo: MetodoPago.EFECTIVO },
        { cantidad: D(80), metodo: MetodoPago.TRANSFERENCIA },
      ]),
    ).toBe('03');
    expect(
      formaDePagoGlobal([
        { cantidad: D(90), metodo: MetodoPago.EFECTIVO },
        { cantidad: D(80), metodo: MetodoPago.TRANSFERENCIA },
      ]),
    ).toBe('01');
  });
});

describe('mesesCompatibles', () => {
  it('bimestral solo con bimestres y lo demas con meses', () => {
    expect(mesesCompatibles('04', '12')).toBe(true);
    expect(mesesCompatibles('04', '13')).toBe(false);
    expect(mesesCompatibles('05', '13')).toBe(true);
    expect(mesesCompatibles('05', '02')).toBe(false);
    expect(mesesCompatibles('09', '01')).toBe(false);
  });
});
