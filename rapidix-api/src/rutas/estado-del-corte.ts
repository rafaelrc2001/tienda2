import { EstadoCorte, Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * El dinero de un corte despues de liquidado: cuanto debe el repartidor y en
 * que estatus queda segun lo que Finanzas le ha aceptado.
 *
 * Funciones puras, sin base de datos. El estatus no se decide en cada boton
 * por su lado: se deduce aqui de los hechos del corte —que se acepto y que
 * no—, para que aceptar un dinero, aceptar la entrega y abonar no puedan
 * dejarlo en estatus distintos ante la misma situacion.
 */

/**
 * Por debajo de medio centavo no hay adeudo. Los montos son Decimal y no
 * dejan colas, pero las pantallas los reciben como numero: sin esto un
 * redondeo de ellas pintaria un adeudo fantasma.
 */
export const TOLERANCIA = new Decimal('0.005');

/** Un abono, con lo unico que las cuentas miran. */
export interface AbonoDelCorte {
  monto: Decimal;
  /** Null mientras Finanzas no lo acepte. */
  aceptadoEn: Date | null;
}

/** Los hechos del corte de los que sale su adeudo y su estatus. */
export interface CorteEnCuenta {
  montoCalculado: Decimal;
  /** El dinero aceptado al liquidar. Null mientras Finanzas no lo acepte. */
  montoRecibido: Decimal | null;
  /** "Entrega aceptada". Null mientras Finanzas no la pulse. */
  entregaAceptadaEn: Date | null;
  abonos: AbonoDelCorte[];
}

/** El abono que espera a Finanzas, si lo hay. La base no deja que haya dos. */
export function abonoPendiente<T extends AbonoDelCorte>(abonos: T[]): T | null {
  return abonos.find((a) => a.aceptadoEn === null) ?? null;
}

/**
 * Lo que el repartidor debe todavia de un corte.
 *
 * Se mide contra el dinero que Finanzas **acepto**, no contra lo declarado:
 * falta el dinero que nunca llego a la caja, no el que el repartidor dijo que
 * traia. Por lo mismo un abono pendiente no cuenta: hasta que se acepta es
 * dinero que sigue en su bolsa. Sin dinero aceptado todavia no hay contra que
 * medir, y entregar de mas no deja saldo a favor.
 */
export function adeudoDelCorte(
  corte: Pick<CorteEnCuenta, 'montoCalculado' | 'montoRecibido' | 'abonos'>,
): Decimal {
  if (corte.montoRecibido === null) return new Decimal(0);
  const abonado = corte.abonos
    .filter((a) => a.aceptadoEn !== null)
    .reduce((suma, a) => suma.add(a.monto), new Decimal(0));
  const adeudo = corte.montoCalculado.sub(corte.montoRecibido).sub(abonado);
  return adeudo.lte(TOLERANCIA) ? new Decimal(0) : adeudo;
}

/**
 * El estatus que le toca al corte despues de que Finanzas acepta algo, o de
 * que el repartidor abona o cancela su abono.
 *
 *  - **LIQUIDADO** mientras Finanzas tenga algo por aceptar: la entrega
 *    entera la primera vez, o un abono pendiente despues.
 *  - **ACEPTADO** con la entrega aceptada y el repartidor debiendo.
 *  - **CERRADO** con la entrega aceptada y sin adeudo. Es el final.
 *
 * El abono pendiente manda sobre lo demas: aunque ese dinero fuera a saldar
 * el adeudo, hasta que se acepta el corte no esta cerrado.
 */
export function estadoTrasAceptar(corte: CorteEnCuenta): EstadoCorte {
  if (corte.entregaAceptadaEn === null) return EstadoCorte.LIQUIDADO;
  if (abonoPendiente(corte.abonos)) return EstadoCorte.LIQUIDADO;
  return adeudoDelCorte(corte).isZero() ? EstadoCorte.CERRADO : EstadoCorte.ACEPTADO;
}
