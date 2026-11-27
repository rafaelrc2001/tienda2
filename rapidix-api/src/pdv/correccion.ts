import { EstadoPago, EstadoPedido, MetodoEntrega, Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

/**
 * "Editar" un pedido del turno: el cajero se equivoco de producto, de
 * cantidad, de cliente o de forma de pago.
 *
 * No se reescribe el pedido encima. Se cancela —con todo lo que eso devuelve:
 * monedero, cashback, gasto del cliente, mercancia— y en la misma transaccion
 * se captura el bueno con el checkout de siempre. Asi el corregido nace con
 * los mismos candados y la misma aritmetica que cualquier otro, y Finanzas ve
 * en la bitacora que folio sustituyo a cual.
 *
 * Solo mientras el turno siga abierto: con el corte hecho su dinero ya se
 * rindio y el pedido no se toca (eso lo revisa el servicio con el turno).
 */
export interface PedidoACorregir {
  estado: EstadoPedido;
  estadoPago: EstadoPago;
  metodoEntrega: MetodoEntrega;
  /** Es de la app y se recogio aqui: no lo capturo el mostrador. */
  deLaApp: boolean;
  /** Tiene CFDI, timbrado o a medio timbrar. */
  facturado: boolean;
  /** Abonos de CXC o en la puerta: dinero que no tendria donde quedar escrito. */
  abonos: number;
}

export interface BloqueoDeCorreccion {
  codigo: string;
  mensaje: string;
}

/** Por que no se puede corregir ese pedido, o `null` si se puede. */
export function bloqueoDeCorreccion(pedido: PedidoACorregir): BloqueoDeCorreccion | null {
  if (pedido.deLaApp) {
    return {
      codigo: 'NO_ES_DEL_MOSTRADOR',
      mensaje: 'Ese pedido lo hizo el cliente en la app: solo se corrigen los capturados en caja.',
    };
  }
  if (pedido.estadoPago === EstadoPago.CANCELADO) {
    return { codigo: 'PEDIDO_CANCELADO', mensaje: 'El pedido está cancelado.' };
  }
  if (pedido.estadoPago === EstadoPago.RETENER) {
    return {
      codigo: 'PAGO_RETENIDO',
      mensaje: 'Finanzas retuvo el pedido: debe liberarlo antes de corregirlo.',
    };
  }
  if (pedido.facturado) {
    return {
      codigo: 'PEDIDO_FACTURADO',
      mensaje: 'El pedido ya tiene factura: cancélala antes de corregirlo.',
    };
  }
  if (pedido.abonos > 0) {
    return {
      codigo: 'PEDIDO_CON_ABONOS',
      mensaje: 'El pedido ya tiene abonos registrados: corrígelo desde Finanzas.',
    };
  }
  // A domicilio, en cuanto Operaciones lo empieza a preparar la mercancia ya
  // se movio en bodega y el camion puede llevarlo: corregirlo seria cambiar
  // lo que otro ya tiene en las manos.
  if (
    pedido.metodoEntrega === MetodoEntrega.DOMICILIO &&
    pedido.estado !== EstadoPedido.CONFIRMADO
  ) {
    return {
      codigo: 'PEDIDO_EN_CAMINO',
      mensaje: 'Operaciones ya está preparando ese pedido a domicilio: ya no se puede corregir.',
    };
  }
  return null;
}

/**
 * El saldo del monedero tal como quedara al cancelar el pedido que se
 * corrige: regresa lo que pago con el y se retira el cashback que le dio, nunca
 * mas de lo que haya. Es la misma cuenta que `FinanzasService.deshacer`, para
 * que la previsualizacion del corregido no rechace un monedero que el
 * confirmar si aceptaria.
 */
export function saldoTrasCancelar(
  saldo: Prisma.Decimal,
  pedido: {
    pagadoConBilletera: Prisma.Decimal;
    cashbackGenerado: Prisma.Decimal;
    cashbackAcreditadoEn: Date | null;
  },
): Prisma.Decimal {
  let resultado = saldo.add(pedido.pagadoConBilletera);
  if (pedido.cashbackAcreditadoEn && pedido.cashbackGenerado.greaterThan(0)) {
    resultado = resultado.sub(Decimal.min(pedido.cashbackGenerado, Decimal.max(resultado, 0)));
  }
  return resultado;
}
