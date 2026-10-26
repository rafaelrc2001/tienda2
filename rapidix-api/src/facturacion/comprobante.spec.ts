import { EstadoPago, MetodoPago, Prisma, TasaIva } from '@prisma/client';
import {
  armarComprobante,
  baseAl16,
  bloqueoDeFacturacion,
  aGuardado,
  claveUnidad,
  conRetencionResico,
  formaDePago,
  PedidoFacturable,
  RenglonFacturable,
  repartirDescuento,
  repartirEnvio,
  repartirMonedero,
  retieneIsrResico,
  totalAFacturar,
  totalFacturado,
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
  const bloqueo = (estadoPago: EstadoPago, pagadoConBilletera: number | string = 0) =>
    bloqueoDeFacturacion({
      estadoPago,
      total: D(100),
      pagadoConBilletera: D(pagadoConBilletera),
    })?.codigo ?? null;

  it('solo deja facturar lo pagado, se haya entregado o no', () => {
    expect(bloqueo(EstadoPago.PAGADO)).toBeNull();
  });

  it('sin importe aparte del monedero no hay que facturar', () => {
    expect(bloqueo(EstadoPago.PAGADO, 99)).toBeNull();
    expect(bloqueo(EstadoPago.PAGADO, 100)).toBe('PAGADO_CON_MONEDERO');
    // Quedan 30 centavos, que al peso son cero.
    expect(bloqueo(EstadoPago.PAGADO, '99.70')).toBe('PAGADO_CON_MONEDERO');
  });

  it('nada que no este pagado, ni el efectivo cobrado en la puerta', () => {
    for (const estadoPago of [
      EstadoPago.PAGO_PENDIENTE,
      EstadoPago.RETENER,
      EstadoPago.CREDITO,
      EstadoPago.REEMBOLSADO,
    ]) {
      expect(bloqueo(estadoPago)).toBe('PEDIDO_SIN_PAGAR');
    }
    expect(bloqueo(EstadoPago.CANCELADO)).toBe('PEDIDO_CANCELADO');
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

describe('repartirMonedero', () => {
  const repartir = (topes: (number | string)[], monedero: number | string) => {
    const { partes, sobrante } = repartirMonedero(topes.map(D), D(monedero));
    return { partes: partes.map((p) => p.toFixed(2)), sobrante: sobrante.toFixed(2) };
  };

  it('partes iguales sin importar lo que valga cada uno', () => {
    expect(repartir(['3.25', '2.75'], 2)).toEqual({ partes: ['1.00', '1.00'], sobrante: '0.00' });
    expect(repartir([10, 10, 10], 1).partes).toEqual(['0.33', '0.33', '0.34']);
  });

  it('lo que no le cabe a uno se reparte entre los demas', () => {
    expect(repartir(['0.50', 10, 10], 6).partes).toEqual(['0.50', '2.75', '2.75']);
  });

  it('lo que no cabe en ninguno queda de sobrante', () => {
    expect(repartir([2, 3], 7)).toEqual({ partes: ['2.00', '3.00'], sobrante: '2.00' });
  });
});

describe('totalAFacturar', () => {
  it('lo pagado aparte del monedero, al peso', () => {
    expect(totalAFacturar({ total: D('5.50'), pagadoConBilletera: D(2) }).toFixed(2)).toBe('4.00');
    expect(totalAFacturar({ total: D(100), pagadoConBilletera: D('10.60') }).toFixed(2)).toBe(
      '89.00',
    );
  });
});

describe('formaDePago', () => {
  it('la del metodo del pedido, nunca el monedero', () => {
    expect(formaDePago({ metodoPago: MetodoPago.EFECTIVO })).toBe('01');
    expect(formaDePago({ metodoPago: MetodoPago.TRANSFERENCIA })).toBe('03');
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

  it('los productos no se redondean: solo el total va en pesos enteros', () => {
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
    // 2.50 de envio a cada uno: 12.50 y 14.50, que ya suman 27.
    expect(c.conceptos.map((k) => k.importe.toFixed(2))).toEqual(['12.50', '14.50']);
    expect(c.descuento.toFixed(2)).toBe('0.00');
    expect(c.total.toFixed(2)).toBe('27.00');
  });

  it('la factura va por el total al peso mas cercano: .50 sube y .49 baja', () => {
    const facturado = (precio: string, tasaIva: TasaIva = TasaIva.CERO) =>
      armarComprobante(
        pedido({ items: [renglon({ precio, cantidad: 1, tasaIva })], total: Number(precio) }),
        [],
        CLAVES,
      ).total.toFixed(2);
    expect(facturado('22.50')).toBe('23.00');
    expect(facturado('22.49')).toBe('22.00');
    expect(facturado('22.83')).toBe('23.00');
    expect(facturado('22.27')).toBe('22.00');
    // Como ORD000147: un producto al 16 % cobrado en $22.50 se factura en $23.
    expect(facturado('22.50', TasaIva.DIECISEIS)).toBe('23.00');
  });

  it('un solo producto al 16 % que no alcanza el entero se pasa un centavo arriba', () => {
    // $7 y $17 no se alcanzan: base 6.03 da 6.99 y 6.04 da 7.01.
    for (const [precio, esperado] of [
      ['7', '7.01'],
      ['17', '17.01'],
      ['6', '6.00'],
    ]) {
      const c = armarComprobante(
        pedido({
          items: [renglon({ precio, cantidad: 1, tasaIva: TasaIva.DIECISEIS })],
          total: Number(precio),
        }),
        [],
        CLAVES,
      );
      exigirConceptosValidos(c);
      expect(c.total.toFixed(2)).toBe(esperado);
    }
  });

  it('producto de 67.80 con envio de 3: la factura dice un solo producto de 71', () => {
    for (const tasaIva of [TasaIva.CERO, TasaIva.DIECISEIS]) {
      const c = armarComprobante(
        pedido({
          items: [renglon({ precio: '67.80', cantidad: 1, tasaIva })],
          envio: D(3),
          total: 70.8,
        }),
        [],
        CLAVES,
      );
      exigirConceptosValidos(c);
      expect(c.conceptos).toHaveLength(1);
      expect(c.conceptos[0].base.add(c.conceptos[0].iva).toFixed(2)).toBe('71.00');
      expect(c.total.toFixed(2)).toBe('71.00');
    }
  });

  it('el redondeo del total se reparte parejo, con tasas mezcladas', () => {
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
    // $23.70 se factura en $24: el envio y los 30 centavos son 3.15 para
    // cada uno, y quedan en 13.55 y 10.45.
    const conIva = c.conceptos.map((k) => k.base.add(k.iva).toFixed(2));
    expect(conIva).toEqual(['13.55', '10.45']);
    expect(c.total.toFixed(2)).toBe('24.00');
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
    // $132.90 se factura en $133: los 10 centavos van al producto con el envio.
    expect(c.conceptos[0].importe.toFixed(2)).toBe('124.10');
    expect(c.conceptos[1].claveUnidad).toBe('E48');
    expect(c.total.toFixed(2)).toBe('133.00');
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
    // $202.63 se factura en $203.
    expect(c.total.toFixed(2)).toBe('203.00');
    expect(c.descuento.greaterThan(0)).toBe(true);
  });

  it('con dos o mas al 16 % y ninguno al 0 % el total es el redondeado exacto', () => {
    for (let centavos = 101; centavos <= 2000; centavos += 1) {
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
      const esperado = totalFacturado(D(precio + (precio + 1) * 2).toDecimalPlaces(2));
      expect(c.total.toFixed(2)).toBe(esperado.toFixed(2));
    }
  });

  it('el monedero es descuento parejo: $50 y $50 con $10 llevan $5 de descuento cada uno', () => {
    const c = armarComprobante(
      pedido({
        items: [renglon({ precio: 50, cantidad: 1 }), renglon({ precio: 50, cantidad: 1 })],
        pagadoConBilletera: D(10),
        total: 100,
        metodoPago: MetodoPago.TRANSFERENCIA,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    expect(c.conceptos.map((k) => k.importe.toFixed(2))).toEqual(['50.00', '50.00']);
    expect(c.conceptos.map((k) => k.descuento.toFixed(2))).toEqual(['5.00', '5.00']);
    expect(c.descuento.toFixed(2)).toBe('10.00');
    expect(c.total.toFixed(2)).toBe('90.00');
    expect(c.formaPago).toBe('03');
  });

  it('el monedero que no cabe en los productos sale del recargo', () => {
    const c = armarComprobante(
      pedido({
        items: [renglon({ precio: 20, cantidad: 1 })],
        recargoFuera: D(10),
        pagadoConBilletera: D(25),
        total: 30,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    expect(c.conceptos.map((k) => k.base.add(k.iva).toFixed(2))).toEqual(['0.00', '5.00']);
    expect(c.total.toFixed(2)).toBe('5.00');
  });

  it('con monedero, envio, cupon e IVA mezclados cuadra con lo pagado aparte', () => {
    for (const billetera of ['0.37', '10', '33.33', '150.99']) {
      const total = D(91 + 84 + 10 + 35 - 17.37);
      const c = armarComprobante(
        pedido({
          items: [
            renglon({ precio: 13, cantidad: 7, tasaIva: TasaIva.DIECISEIS, categoria: 'Bebidas' }),
            renglon({ precio: 28, cantidad: 3, categoria: 'Abarrotes' }),
            renglon({ precio: '3.333333333333333', cantidad: 3, tasaIva: TasaIva.DIECISEIS }),
          ],
          envio: D(35),
          descuento: D('17.37'),
          pagadoConBilletera: D(billetera),
          total: total.toNumber(),
        }),
        [],
        CLAVES,
      );
      exigirConceptosValidos(c);
      expect(c.total.toFixed(2)).toBe(
        totalAFacturar({ total, pagadoConBilletera: D(billetera) }).toFixed(2),
      );
    }
  });

  it('como ORD000162: $3 y $2.50 al 16 % con $2 de monedero se facturan en $4', () => {
    const c = armarComprobante(
      pedido({
        items: [
          renglon({ precio: 3, cantidad: 1, tasaIva: TasaIva.DIECISEIS }),
          renglon({ precio: '2.50', cantidad: 1, tasaIva: TasaIva.DIECISEIS }),
        ],
        pagadoConBilletera: D(2),
        total: 5.5,
        metodoPago: MetodoPago.TRANSFERENCIA,
      }),
      [],
      CLAVES,
    );
    exigirConceptosValidos(c);
    // $3.50 pagados aparte se facturan en $4: los 50 centavos suben 25 a cada
    // uno (3.25 y 2.75) y el monedero resta $1 a cada uno como descuento.
    expect(c.conceptos.map((k) => k.base.add(k.iva).toFixed(2))).toEqual(['2.25', '1.75']);
    expect(c.conceptos.map((k) => [k.importe.toFixed(2), k.base.toFixed(2)])).toEqual([
      ['2.80', '1.94'],
      ['2.37', '1.51'],
    ]);
    expect(c.descuento.toFixed(2)).toBe('1.72');
    expect(c.total.toFixed(2)).toBe('4.00');
    expect(c.formaPago).toBe('03');
  });

  it('con un producto al 0 % absorbe el centavo y el total es el redondeado exacto', () => {
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
      expect(c.total.toFixed(2)).toBe(totalFacturado(total).toFixed(2));
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

describe('retieneIsrResico', () => {
  const RESICO = { regimen: '626', rfc: 'PEPJ800101AB1' };

  it('retiene cuando el negocio es RESICO y el receptor es persona moral', () => {
    expect(retieneIsrResico(RESICO, 'ABC010101AB1')).toBe(true);
  });

  it('no retiene a una persona fisica', () => {
    expect(retieneIsrResico(RESICO, 'PEPJ800101AB1')).toBe(false);
  });

  it('no retiene si el negocio no es RESICO', () => {
    expect(retieneIsrResico({ regimen: '612', rfc: null }, 'ABC010101AB1')).toBe(false);
    expect(retieneIsrResico({ regimen: null, rfc: null }, 'ABC010101AB1')).toBe(false);
  });

  it('sin RFC del negocio basta el regimen; con RFC de persona moral no retiene', () => {
    expect(retieneIsrResico({ regimen: '626', rfc: null }, 'ABC010101AB1')).toBe(true);
    expect(retieneIsrResico({ regimen: '626', rfc: 'XYZ010101AB1' }, 'ABC010101AB1')).toBe(false);
  });
});

describe('conRetencionResico', () => {
  it('retiene 1.25 % de la base de cada concepto y lo resta del total', () => {
    // $116 al 16 %: base 100, IVA 16, retencion 1.25 -> total 114.75.
    const c = conRetencionResico(
      armarComprobante(
        pedido({
          items: [renglon({ precio: 116, cantidad: 1, tasaIva: TasaIva.DIECISEIS })],
          total: 116,
        }),
        [],
        CLAVES,
      ),
    );
    expect(c.subtotal.toFixed(2)).toBe('100.00');
    expect(c.iva.toFixed(2)).toBe('16.00');
    expect(c.retencionIsr.toFixed(2)).toBe('1.25');
    expect(c.total.toFixed(2)).toBe('114.75');
    expect(c.conceptos[0].retencionIsr?.toFixed(2)).toBe('1.25');
  });

  it('redondea por concepto y el total retenido es la suma de los conceptos', () => {
    const c = conRetencionResico(
      armarComprobante(
        pedido({
          items: [
            renglon({ precio: 33, cantidad: 1 }),
            renglon({ precio: 58, cantidad: 1, tasaIva: TasaIva.DIECISEIS }),
          ],
          total: 91,
        }),
        [],
        CLAVES,
      ),
    );
    const suma = c.conceptos.reduce((s, k) => s.add(k.retencionIsr!), D(0));
    expect(c.retencionIsr.toFixed(2)).toBe(suma.toFixed(2));
    for (const k of c.conceptos) {
      expect(k.retencionIsr!.toFixed(2)).toBe(k.base.mul('0.0125').toDecimalPlaces(2).toFixed(2));
    }
    expect(c.total.toFixed(2)).toBe(c.subtotal.sub(c.descuento).add(c.iva).sub(suma).toFixed(2));
  });

  it('el concepto guardado lleva la retencion solo si la hay', () => {
    const sin = armarComprobante(
      pedido({ items: [renglon({ precio: 10, cantidad: 1 })], total: 10 }),
      [],
      CLAVES,
    );
    expect(aGuardado(sin.conceptos[0]).retencionIsr).toBeUndefined();
    expect(aGuardado(conRetencionResico(sin).conceptos[0]).retencionIsr).toBe('0.13');
  });
});
