import { Prisma } from '@prisma/client';
import {
  ahorro,
  ListasDePrecio,
  precioListaAnterior,
  precioUnitario,
  upsell,
  validarEscalones,
} from './precios';

const D = (n: number) => new Prisma.Decimal(n);

/** El ejemplo de la spec: 1-4 a $19.95, 5-9 a $18.50, 10 o mas a $17.00. */
const escalonado: ListasDePrecio = {
  precioVenta: D(19.95),
  piso2: 5,
  precio2: D(18.5),
  piso3: 10,
  precio3: D(17),
};

const sinListas: ListasDePrecio = {
  precioVenta: D(28),
  piso2: null,
  precio2: null,
  piso3: null,
  precio3: null,
};

describe('precioUnitario', () => {
  it.each([
    [1, 19.95],
    [4, 19.95],
    [5, 18.5],
    [9, 18.5],
    [10, 17],
    [999, 17],
  ])('con %i piezas cobra %d', (cantidad, esperado) => {
    expect(precioUnitario(escalonado, cantidad).toNumber()).toBe(esperado);
  });

  it('sin listas cobra siempre el precio de venta', () => {
    expect(precioUnitario(sinListas, 50).toNumber()).toBe(28);
  });

  it('con una sola lista de volumen, pasar su piso conserva su precio', () => {
    const unaLista = { ...sinListas, piso2: 6, precio2: D(25) };
    expect(precioUnitario(unaLista, 5).toNumber()).toBe(28);
    expect(precioUnitario(unaLista, 60).toNumber()).toBe(25);
  });
});

describe('precioListaAnterior', () => {
  it('no tacha nada en la primera lista', () => {
    expect(precioListaAnterior(escalonado, 3)).toBeNull();
  });

  it('tacha el precio de la lista anterior', () => {
    expect(precioListaAnterior(escalonado, 5)?.toNumber()).toBe(19.95);
    expect(precioListaAnterior(escalonado, 12)?.toNumber()).toBe(18.5);
  });
});

describe('ahorro', () => {
  it('compara contra el precio de venta', () => {
    expect(ahorro(escalonado, 12).toNumber()).toBe(35.4);
  });

  it('es cero en la primera lista', () => {
    expect(ahorro(escalonado, 3).toNumber()).toBe(0);
  });
});

describe('upsell', () => {
  it('no aparece antes del 80 % del piso siguiente', () => {
    expect(upsell(escalonado, 3)).toBeNull();
  });

  it('con 4 piezas ofrece la lista 2', () => {
    const oferta = upsell(escalonado, 4);
    expect(oferta?.faltan).toBe(1);
    expect(oferta?.precioSiguiente.toNumber()).toBe(18.5);
    expect(oferta?.ahorro.toNumber()).toBe(7.25);
  });

  it('con 8 piezas ofrece la lista 3', () => {
    const oferta = upsell(escalonado, 8);
    expect(oferta?.faltan).toBe(2);
    expect(oferta?.precioSiguiente.toNumber()).toBe(17);
    expect(oferta?.ahorro.toNumber()).toBe(15);
  });

  it('no aparece en la mejor lista, sin piezas ni sin listas', () => {
    expect(upsell(escalonado, 12)).toBeNull();
    expect(upsell(escalonado, 0)).toBeNull();
    expect(upsell(sinListas, 4)).toBeNull();
  });
});

describe('validarEscalones', () => {
  it('acepta listas coherentes y ninguna lista', () => {
    expect(validarEscalones(19.95, [])).toBeNull();
    expect(
      validarEscalones(19.95, [
        { piso: 5, precio: 18.5 },
        { piso: 10, precio: 17 },
      ]),
    ).toBeNull();
  });

  it('rechaza pisos que no suben', () => {
    expect(validarEscalones(20, [{ piso: 1, precio: 18 }])).toMatch(/2 piezas/);
    expect(
      validarEscalones(20, [
        { piso: 5, precio: 18 },
        { piso: 5, precio: 17 },
      ]),
    ).toMatch(/más piezas/);
  });

  it('rechaza precios que no bajan', () => {
    expect(validarEscalones(20, [{ piso: 5, precio: 20 }])).toMatch(/precio de venta/);
    expect(
      validarEscalones(20, [
        { piso: 5, precio: 18 },
        { piso: 10, precio: 18 },
      ]),
    ).toMatch(/lista 2/);
  });

  it('rechaza mas de dos listas de volumen', () => {
    expect(
      validarEscalones(20, [
        { piso: 2, precio: 19 },
        { piso: 3, precio: 18 },
        { piso: 4, precio: 17 },
      ]),
    ).toMatch(/máximo/);
  });
});
