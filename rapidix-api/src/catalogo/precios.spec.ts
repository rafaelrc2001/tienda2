import { Prisma } from '@prisma/client';
import {
  ahorro,
  importeDeLinea,
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

describe('listas que no bajan de precio', () => {
  /** La lista 2 cuesta mas que el precio de venta; la 3 vuelve a bajar. */
  const sube: ListasDePrecio = {
    precioVenta: D(10),
    piso2: 5,
    precio2: D(12),
    piso3: 10,
    precio3: D(9),
  };

  it('cobra el precio de la lista en la que cae, sea mayor o menor', () => {
    expect(precioUnitario(sube, 5).toNumber()).toBe(12);
    expect(precioUnitario(sube, 10).toNumber()).toBe(9);
  });

  it('no tacha un precio que no era mas caro, ni ahorra al ofrecerlo', () => {
    expect(precioListaAnterior(sube, 5)).toBeNull();
    expect(ahorro(sube, 5).toNumber()).toBe(0);
    // El aviso lo decide la cantidad: sale igual, pero sin ahorro que anunciar.
    expect(upsell({ ...sube, piso2: 20, piso3: 40 }, 17)?.ahorro.toNumber()).toBe(0);
  });

  it('si la siguiente si es mas barata, la tacha y la ofrece', () => {
    expect(precioListaAnterior(sube, 10)?.toNumber()).toBe(12);
    expect(upsell(sube, 9)?.precioSiguiente.toNumber()).toBe(9);
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
  /** El caso del negocio: 60 por $145 y 120 por $280. */
  const botella: ListasDePrecio = {
    precioVenta: D(3),
    piso2: 60,
    precio2: D(2.416666666666667),
    piso3: 120,
    precio3: D(2.333333333333333),
  };

  it('no aparece antes del 85 % del piso siguiente', () => {
    expect(upsell(escalonado, 4)).toBeNull();
    expect(upsell(botella, 50)).toBeNull();
    expect(upsell(botella, 101)).toBeNull();
  });

  it('al 85 % ofrece la lista 2', () => {
    const oferta = upsell(botella, 51);
    expect(oferta?.faltan).toBe(9);
    expect(oferta?.precioSiguiente.toNumber()).toBe(2.416666666666667);
    expect(oferta?.ahorro.toNumber()).toBe(35);
  });

  it('al 85 % ofrece tambien la lista 3', () => {
    const oferta = upsell(botella, 102);
    expect(oferta?.faltan).toBe(18);
    expect(oferta?.ahorro.toNumber()).toBe(10);
    expect(upsell(botella, 119)?.faltan).toBe(1);
  });

  it('en pisos chicos el 85 % es la ultima pieza', () => {
    expect(upsell(escalonado, 9)?.faltan).toBe(1);
    expect(upsell(escalonado, 9)?.ahorro.toNumber()).toBe(15);
  });

  it('sale aunque la siguiente lista no sea mas barata, sin ahorro', () => {
    const igual = { ...botella, precio3: D(2.42) };
    const oferta = upsell(igual, 119);
    expect(oferta?.faltan).toBe(1);
    expect(oferta?.ahorro.toNumber()).toBe(0);
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

  it('acepta precios que no bajan: los pone el negocio', () => {
    expect(validarEscalones(20, [{ piso: 5, precio: 20 }])).toBeNull();
    expect(
      validarEscalones(20, [
        { piso: 5, precio: 18 },
        { piso: 10, precio: 19 },
      ]),
    ).toBeNull();
  });

  it('rechaza precios negativos', () => {
    expect(validarEscalones(20, [{ piso: 5, precio: -1 }])).toMatch(/negativo/);
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

describe('importeDeLinea', () => {
  it('redondea el renglon a centavos: 3 piezas a 3.3333 son $10.00', () => {
    expect(importeDeLinea(D(3.3333), 3).toNumber()).toBe(10);
  });

  it('con quince decimales cuadra tambien en cantidades grandes', () => {
    expect(importeDeLinea(D(3.333333333333333), 3000).toNumber()).toBe(10000);
    expect(importeDeLinea(D(1.428571428571429), 700).toNumber()).toBe(1000);
  });

  it('con dos decimales el mismo renglon se queda en $9.99', () => {
    expect(importeDeLinea(D(3.33), 3).toNumber()).toBe(9.99);
  });

  it('no toca un precio que ya esta en centavos', () => {
    expect(importeDeLinea(D(12.5), 4).toNumber()).toBe(50);
  });
});
