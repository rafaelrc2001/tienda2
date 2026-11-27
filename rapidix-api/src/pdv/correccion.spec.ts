import { EstadoPago, EstadoPedido, MetodoEntrega, Prisma } from '@prisma/client';
import { bloqueoDeCorreccion, PedidoACorregir, saldoTrasCancelar } from './correccion';

const Decimal = Prisma.Decimal;

function pedido(cambios: Partial<PedidoACorregir> = {}): PedidoACorregir {
  return {
    estado: EstadoPedido.ENTREGADO,
    estadoPago: EstadoPago.PAGADO,
    metodoEntrega: MetodoEntrega.TIENDA,
    deLaApp: false,
    facturado: false,
    abonos: 0,
    ...cambios,
  };
}

describe('bloqueoDeCorreccion', () => {
  it('deja corregir uno de mostrador entregado y pagado', () => {
    expect(bloqueoDeCorreccion(pedido())).toBeNull();
  });

  it('deja corregir uno a credito sin abonos', () => {
    expect(bloqueoDeCorreccion(pedido({ estadoPago: EstadoPago.CREDITO }))).toBeNull();
  });

  it('deja corregir uno a domicilio mientras siga confirmado', () => {
    expect(
      bloqueoDeCorreccion(
        pedido({ metodoEntrega: MetodoEntrega.DOMICILIO, estado: EstadoPedido.CONFIRMADO }),
      ),
    ).toBeNull();
  });

  it.each<[string, Partial<PedidoACorregir>]>([
    ['NO_ES_DEL_MOSTRADOR', { deLaApp: true }],
    ['PEDIDO_CANCELADO', { estadoPago: EstadoPago.CANCELADO }],
    ['PAGO_RETENIDO', { estadoPago: EstadoPago.RETENER }],
    ['PEDIDO_FACTURADO', { facturado: true }],
    ['PEDIDO_CON_ABONOS', { estadoPago: EstadoPago.CREDITO, abonos: 1 }],
    [
      'PEDIDO_EN_CAMINO',
      { metodoEntrega: MetodoEntrega.DOMICILIO, estado: EstadoPedido.EN_PREPARACION },
    ],
  ])('bloquea con %s', (codigo, cambios) => {
    expect(bloqueoDeCorreccion(pedido(cambios))?.codigo).toBe(codigo);
  });
});

describe('saldoTrasCancelar', () => {
  const datos = (billetera: number, cashback: number, acreditado = true) => ({
    pagadoConBilletera: new Decimal(billetera),
    cashbackGenerado: new Decimal(cashback),
    cashbackAcreditadoEn: acreditado ? new Date() : null,
  });

  it('devuelve el monedero usado y retira el cashback acreditado', () => {
    expect(saldoTrasCancelar(new Decimal(10), datos(5, 3)).toNumber()).toBe(12);
  });

  it('no retira el cashback que nunca se acredito', () => {
    expect(saldoTrasCancelar(new Decimal(10), datos(0, 3, false)).toNumber()).toBe(10);
  });

  it('nunca deja el saldo en negativo si el cashback ya se gasto', () => {
    expect(saldoTrasCancelar(new Decimal(1), datos(0, 3)).toNumber()).toBe(0);
  });
});
