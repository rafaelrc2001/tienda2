import { EstadoPago, EstadoPedido, MetodoPago, Prisma, TasaIva } from '@prisma/client';
import {
  armarComprobante,
  baseAl16,
  bloqueoDeFacturacion,
  claveUnidad,
  formaDePago,
  PedidoFacturable,
  RenglonFacturable,
  repartirDescuento,
} from './comprobante';

const D = (n: number | string) => new Prisma.Decimal(n);
const CLAVES = { producto: '01010101', servicio: '78102203' };

const renglon = (
  r: Partial<Omit<RenglonFacturable, 'precioUnitario'>> & {
    precio: number | string;
    cantidad: number;
  },
): RenglonFacturable => ({
  nombre: r.nombre ?? 'Producto',
  categoria: r.categoria ?? 'Abarrotes',
  unidad: r.unidad ?? 'pza',
  cantidad: r.cantidad,
  precioUnitario: D(r.precio),
  tasaIva: r.tasaIva ?? TasaIva.CERO,
});

const pedido = (
  p: Partial<Omit<PedidoFacturable, 'total'>> & { items: RenglonFacturable[]; total: number },
): PedidoFacturable => ({
  items: p.items,
  envio: p.envio ?? D(0),
  recargoFuera: p.recargoFuera ?? D(0),
  descuento: p.descuento ?? D(0),
  total: D(p.total).toDecimalPlaces(2),
  pagadoConBilletera: p.pagadoConBilletera ?? D(0),
  metodoPago: p.metodoPago ?? MetodoPago.EFECTIVO,
});

/** Lo que el SAT recalcula de cada concepto: si no cuadra, rechaza el timbre. */
function exigirConceptosValidos(c: ReturnType<typeof armarComprobante>): void {
  for (const k of c.conceptos) {
    expect(k.base.toFixed(2)).toBe(k.importe.sub(k.descuento).toFixed(2));
    expect(k.descuento.greaterThanOrEqualTo(0)).toBe(true);
    const tasa = k.tasa === TasaIva.DIECISEIS ? D('0.16') : D(0);
    expect(k.iva.toFixed(2)).toBe(k.base.mul(tasa).toDecimalPlaces(2).toFixed(2));
    expect(k.valorUnitario.mul(k.cantidad).toDecimalPlaces(2).toFixed(2)).toBe(
      k.importe.toFixed(2),
    );
  }
}

describe('bloqueoDeFacturacion', () => {
  it('solo deja facturar lo entregado y pagado', () => {
    expect(
      bloqueoDeFacturacion({ estado: EstadoPedido.ENTREGADO, estadoPago: EstadoPago.PAGADO }),
    ).toBeNull();
    expect(
      bloqueoDeFacturacion({ estado: EstadoPedido.EN_RUTA, estadoPago: EstadoPago.PAGADO })?.codigo,
    ).toBe('PEDIDO_SIN_ENTREGAR');
    expect(
      bloqueoDeFacturacion({ estado: EstadoPedido.ENTREGADO, estadoPago: EstadoPago.CREDITO })
        ?.codigo,
    ).toBe('PEDIDO_SIN_PAGAR');
    expect(
      bloqueoDeFacturacion({ estado: EstadoPedido.CONFIRMADO, estadoPago: EstadoPago.CANCELADO })
        ?.codigo,
    ).toBe('PEDIDO_CANCELADO');
  });
});

describe('claveUnidad', () => {
  it('reconoce las unidades del catalogo y lo demas es pieza', () => {
    expect(claveUnidad('kg').clave).toBe('KGM');
    expect(claveUnidad('L').clave).toBe('LTR');
    expect(claveUnidad('Kilos').clave).toBe('KGM');
    expect(claveUnidad('pza').clave).toBe('H87');
    expect(claveUnidad('manojo').clave).toBe('H87');
  });
});

describe('baseAl16', () => {
  it('encuentra la base cuyo IVA redondeado da exacto lo cobrado', () => {
    const { base, resto } = baseAl16(D(116));
    expect(base.toFixed(2)).toBe('100.00');
    expect(resto.isZero()).toBe(true);
  });

  it('cuando el monto no se alcanza devuelve el centavo que falta', () => {
    // Recorre centavos: los que no tienen base exacta dejan a lo mas uno de resto.
    for (let c = 1; c <= 500; c++) {
      const objetivo = D(c).div(100);
      const { base, resto } = baseAl16(objetivo);
      expect(resto.abs().lessThanOrEqualTo(D('0.01'))).toBe(true);
      expect(base.add(base.mul('0.16').toDecimalPlaces(2)).add(resto).toFixed(2)).toBe(
        objetivo.toFixed(2),
      );
    }
  });
});

describe('repartirDescuento', () => {
  it('reparte en proporcion y la suma es exacta', () => {
    const partes = repartirDescuento(
      [
        { importe: D(10), categoria: 'A' },
        { importe: D(20), categoria: 'A' },
        { importe: D(70), categoria: 'A' },
      ],
      D('10.01'),
      [],
    );
    expect(partes.map((p) => p.toFixed(2))).toEqual(['1.00', '2.00', '7.01']);
  });

  it('con categorias del cupon solo toca esos renglones', () => {
    const partes = repartirDescuento(
      [
        { importe: D(50), categoria: 'Frutas' },
        { importe: D(50), categoria: 'Bebidas' },
      ],
      D(10),
      ['Frutas'],
    );
    expect(partes.map((p) => p.toFixed(2))).toEqual(['10.00', '0.00']);
  });

  it('si la entrega dejo fuera esas categorias, cae en lo que quedo', () => {
    const partes = repartirDescuento([{ importe: D(50), categoria: 'Bebidas' }], D(10), ['Frutas']);
    expect(partes[0].toFixed(2)).toBe('10.00');
  });
});

describe('formaDePago', () => {
  it('la que cubrio la mayor parte', () => {
    expect(
      formaDePago({ total: D(100), pagadoConBilletera: D(0), metodoPago: MetodoPago.EFECTIVO }),
    ).toBe('01');
    expect(
      formaDePago({
        total: D(100),
        pagadoConBilletera: D(10),
        metodoPago: MetodoPago.TRANSFERENCIA,
      }),
    ).toBe('03');
    expect(
      formaDePago({ total: D(100), pagadoConBilletera: D(60), metodoPago: MetodoPago.EFECTIVO }),
    ).toBe('05');
  });
});

describe('armarComprobante', () => {
  it('todo al 0 %: el CFDI es el ticket', () => {
    const c = armarComprobante(
      pedido({
        items: [
          renglon({ precio: 18, cantidad: 2, unidad: 'kg' }),
          renglon({ precio: 24, cantidad: 1 }),
        ],
        total: 60,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    expect(c.iva.toFixed(2)).toBe('0.00');
    expect(c.total.toFixed(2)).toBe('60.00');
    expect(c.conceptos[0].claveUnidad).toBe('KGM');
  });

  it('desglosa el IVA del 16 % sin moverse del total', () => {
    const c = armarComprobante(
      pedido({
        items: [renglon({ precio: 14, cantidad: 3, tasaIva: TasaIva.DIECISEIS })],
        total: 42,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    expect(c.total.toFixed(2)).toBe('42.00');
    expect(c.descuento.toFixed(2)).toBe('0.00');
  });

  it('envio y recargo van como servicios al 16 % al final', () => {
    const c = armarComprobante(
      pedido({
        items: [renglon({ precio: 89, cantidad: 1, unidad: 'kg' })],
        envio: D(35),
        recargoFuera: D('8.90'),
        total: 132.9,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    expect(c.conceptos.map((k) => k.descripcion)).toEqual([
      'Producto',
      'Envío a domicilio',
      'Recargo por servicio fuera de horario',
    ]);
    expect(c.conceptos[1].claveUnidad).toBe('E48');
    expect(c.total.toFixed(2)).toBe('132.90');
  });

  it('con cupon y tasas mezcladas cuadra al centavo', () => {
    const c = armarComprobante(
      pedido({
        items: [
          renglon({ precio: 13, cantidad: 7, tasaIva: TasaIva.DIECISEIS, categoria: 'Bebidas' }),
          renglon({ precio: 28, cantidad: 3, categoria: 'Abarrotes' }),
          renglon({ precio: '3.333333333333333', cantidad: 3, tasaIva: TasaIva.DIECISEIS }),
        ],
        envio: D(35),
        descuento: D('17.37'),
        total: 91 + 84 + 10 + 35 - 17.37,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    expect(c.total.toFixed(2)).toBe((91 + 84 + 10 + 35 - 17.37).toFixed(2));
    expect(c.descuento.greaterThan(0)).toBe(true);
  });

  it('sin ningun producto al 0 % queda a lo mas a un centavo', () => {
    for (let centavos = 101; centavos <= 400; centavos += 7) {
      const precio = centavos / 100;
      const c = armarComprobante(
        pedido({
          items: [
            renglon({ precio, cantidad: 1, tasaIva: TasaIva.DIECISEIS }),
            renglon({ precio: precio + 1, cantidad: 2, tasaIva: TasaIva.DIECISEIS }),
          ],
          total: precio + (precio + 1) * 2,
        }),
        [],
        CLAVES,
      );
      exigirConceptosValidos(c);
      expect(
        c.total
          .sub(D(precio + (precio + 1) * 2).toDecimalPlaces(2))
          .abs()
          .lessThanOrEqualTo(D('0.01')),
      ).toBe(true);
    }
  });

  it('con un producto al 0 % absorbe el centavo y el total es exacto', () => {
    for (let centavos = 101; centavos <= 400; centavos += 7) {
      const precio = centavos / 100;
      const total = D(precio).add(18);
      const c = armarComprobante(
        pedido({
          items: [
            renglon({ precio, cantidad: 1, tasaIva: TasaIva.DIECISEIS }),
            renglon({ precio: 18, cantidad: 1 }),
          ],
          total: total.toNumber(),
        }),
        [],
        CLAVES,
      );
      exigirConceptosValidos(c);
      expect(c.total.toFixed(2)).toBe(total.toFixed(2));
    }
  });

  it('ignora los renglones que no se aceptaron en la puerta', () => {
    const c = armarComprobante(
      pedido({
        items: [renglon({ precio: 18, cantidad: 0 }), renglon({ precio: 24, cantidad: 1 })],
        total: 24,
      }),
      [],
      CLAVES,
    );
    expect(c.conceptos).toHaveLength(1);
  });
});
