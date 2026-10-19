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
  redondearAPesos,
  repartirEnvio,
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
  claveProdServ: r.claveProdServ,
  claveUnidad: r.claveUnidad,
});

const pedido = (
  p: Partial<Omit<PedidoFacturable, 'total'>> & { items: RenglonFacturable[]; total: number },
): PedidoFacturable => ({
  items: p.items,
  envio: p.envio ?? D(0),
  recargoFuera: p.recargoFuera ?? D(0),
  descuento: p.descuento ?? D(0),
  redondeo: p.redondeo ?? D(0),
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
  const bloqueo = (
    estado: EstadoPedido,
    estadoPago: EstadoPago,
    metodoPago: MetodoPago = MetodoPago.EFECTIVO,
  ) => bloqueoDeFacturacion({ estado, estadoPago, metodoPago })?.codigo ?? null;

  it('solo deja facturar lo entregado y pagado', () => {
    expect(bloqueo(EstadoPedido.ENTREGADO, EstadoPago.PAGADO)).toBeNull();
    expect(bloqueo(EstadoPedido.EN_RUTA, EstadoPago.PAGADO)).toBe('PEDIDO_SIN_ENTREGAR');
    expect(bloqueo(EstadoPedido.ENTREGADO, EstadoPago.CREDITO)).toBe('PEDIDO_SIN_PAGAR');
    expect(bloqueo(EstadoPedido.CONFIRMADO, EstadoPago.CANCELADO)).toBe('PEDIDO_CANCELADO');
  });

  it('el efectivo cobrado en la puerta se factura sin esperar el corte', () => {
    expect(bloqueo(EstadoPedido.ENTREGADO, EstadoPago.PAGO_PENDIENTE)).toBeNull();
    expect(bloqueo(EstadoPedido.EN_RUTA, EstadoPago.PAGO_PENDIENTE)).toBe('PEDIDO_SIN_ENTREGAR');
  });

  it('la transferencia pendiente espera a que se valide', () => {
    expect(
      bloqueo(EstadoPedido.ENTREGADO, EstadoPago.PAGO_PENDIENTE, MetodoPago.TRANSFERENCIA),
    ).toBe('PEDIDO_SIN_PAGAR');
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

describe('repartirEnvio', () => {
  it('partes iguales y el ultimo se lleva el centavo', () => {
    expect(repartirEnvio(2, D(6)).map((p) => p.toFixed(2))).toEqual(['3.00', '3.00']);
    expect(repartirEnvio(3, D(10)).map((p) => p.toFixed(2))).toEqual(['3.33', '3.33', '3.34']);
    expect(repartirEnvio(0, D(6))).toEqual([]);
  });
});

describe('redondearAPesos', () => {
  const ajustes = (montos: (number | string)[], absorbe: number) =>
    redondearAPesos(montos.map(D), absorbe).map((a) => a.toFixed(2));

  it('cada uno al peso mas cercano y el que absorbe se lleva la diferencia', () => {
    expect(ajustes(['12.50', '14.50'], 1)).toEqual(['0.50', '-0.50']);
    expect(ajustes(['12.50', '14.50'], 0)).toEqual(['-0.50', '0.50']);
    expect(ajustes(['10.40', '12.30', '5.25'], 2)).toEqual(['-0.40', '-0.30', '0.70']);
  });

  it('el que absorbe se queda con los centavos del pedido', () => {
    // 10.40 + 12.35 = 22.75: el primero baja a 10 y el segundo sube a 12.75.
    expect(ajustes(['10.40', '12.35'], 1)).toEqual(['-0.40', '0.40']);
  });

  it('no deja conceptos en cero', () => {
    expect(ajustes(['0.30', '5'], 1)).toEqual(['0.00', '0.00']);
    // 5.70 sube a 6 y dejaria al que absorbe en 0.00.
    expect(ajustes(['5.70', '0.30'], 1)).toEqual(['0.00', '0.00']);
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

  it('usa las claves del SAT del producto y la generica en el que no tiene', () => {
    const c = armarComprobante(
      pedido({
        items: [
          renglon({
            precio: 12,
            cantidad: 1,
            unidad: 'kg',
            claveProdServ: '24122002',
            claveUnidad: { clave: 'H87', nombre: 'Pieza' },
          }),
          renglon({ precio: 18, cantidad: 1, unidad: 'kg' }),
        ],
        envio: D(35),
        total: 65,
      }),
      [],
      CLAVES,
    );
    expect(c.conceptos.map((k) => [k.claveProdServ, k.claveUnidad, k.unidad])).toEqual([
      ['24122002', 'H87', 'Pieza'],
      ['01010101', 'KGM', 'Kilogramo'],
    ]);
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

  it('el envio se reparte parejo dentro de los productos, sin concepto propio', () => {
    const uno = armarComprobante(
      pedido({ items: [renglon({ precio: 10, cantidad: 1 })], envio: D(6), total: 16 }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(uno);
    expect(uno.conceptos.map((k) => k.importe.toFixed(2))).toEqual(['16.00']);

    const dos = armarComprobante(
      pedido({
        items: [renglon({ precio: 10, cantidad: 1 }), renglon({ precio: 12, cantidad: 1 })],
        envio: D(6),
        total: 28,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(dos);
    expect(dos.conceptos.map((k) => k.importe.toFixed(2))).toEqual(['13.00', '15.00']);
    expect(dos.total.toFixed(2)).toBe('28.00');
  });

  it('cada producto queda en pesos enteros y el total no se mueve', () => {
    const c = armarComprobante(
      pedido({
        items: [renglon({ precio: 10, cantidad: 1 }), renglon({ precio: 12, cantidad: 1 })],
        envio: D(5),
        total: 27,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    // 12.50 y 14.50 con el envio: el primero sube a 13 y el ultimo baja a 14.
    expect(c.conceptos.map((k) => k.importe.toFixed(2))).toEqual(['13.00', '14.00']);
    expect(c.descuento.toFixed(2)).toBe('0.00');
    expect(c.total.toFixed(2)).toBe('27.00');
  });

  it('los centavos del pedido van al ultimo al 0 %', () => {
    const c = armarComprobante(
      pedido({
        items: [
          renglon({ precio: '10.40', cantidad: 1 }),
          renglon({ precio: '7.30', cantidad: 1, tasaIva: TasaIva.DIECISEIS }),
        ],
        envio: D(6),
        total: 23.7,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    // 13.40 y 10.30: el del 16 % baja a 10 y el del 0 % se queda con 13.70.
    const conIva = c.conceptos.map((k) => k.base.add(k.iva).toFixed(2));
    expect(conIva).toEqual(['13.70', '10.00']);
    expect(c.total.toFixed(2)).toBe('23.70');
  });

  it('el envio dentro de un producto al 16 % lleva su IVA y no cuenta como descuento', () => {
    const c = armarComprobante(
      pedido({
        items: [renglon({ precio: 14, cantidad: 3, tasaIva: TasaIva.DIECISEIS })],
        envio: D(35),
        total: 77,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    expect(c.conceptos).toHaveLength(1);
    expect(c.descuento.toFixed(2)).toBe('0.00');
    expect(c.total.toFixed(2)).toBe('77.00');
  });

  it('el redondeo del efectivo se reparte en los productos y la factura sale entera', () => {
    // $10.40 + $12.35 = $22.75, cobrado en efectivo a $23.
    const c = armarComprobante(
      pedido({
        items: [renglon({ precio: '10.40', cantidad: 1 }), renglon({ precio: '12.35', cantidad: 1 })],
        redondeo: D('0.25'),
        total: 23,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    expect(c.conceptos).toHaveLength(2);
    // Con su parte del redondeo quedan en 10.52 y 12.48: 11 y 12.
    expect(c.conceptos.map((k) => k.importe.toFixed(2))).toEqual(['11.00', '12.00']);
    expect(c.total.toFixed(2)).toBe('23.00');
  });

  it('el recargo sigue como servicio al 16 % al final', () => {
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
      'Recargo por servicio fuera de horario',
    ]);
    expect(c.conceptos[0].importe.toFixed(2)).toBe('124.00');
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
