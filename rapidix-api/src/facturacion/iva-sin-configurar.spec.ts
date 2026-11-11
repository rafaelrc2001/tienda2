import { TasaIva } from '@prisma/client';
import { ivaSinConfigurar } from './facturacion.service';

const renglon = (
  nombre: string,
  tasaIva: TasaIva | null,
  delProducto: TasaIva | null = null,
  cantidad = 1,
) => ({ nombre, cantidad, tasaIva, producto: { tasaIva: delProducto } });

describe('ivaSinConfigurar', () => {
  it('sin tasa en el renglon ni en el producto no se factura', () => {
    expect(ivaSinConfigurar([renglon('Agua mineral', null)])).toContain('Agua mineral');
  });

  it('el renglon vendido sin tasa toma la que se le configuro despues al producto', () => {
    expect(ivaSinConfigurar([renglon('Agua mineral', null, TasaIva.DIECISEIS)])).toBeNull();
  });

  it('la tasa congelada al vender manda aunque el producto ya no la tenga', () => {
    expect(ivaSinConfigurar([renglon('Arroz 1kg', TasaIva.CERO, null)])).toBeNull();
  });

  it('nombra cada producto una vez y no cuenta lo que no se acepto en la puerta', () => {
    const motivo = ivaSinConfigurar([
      renglon('Agua mineral', null),
      renglon('Agua mineral', null),
      renglon('Refresco', null, null, 0),
      renglon('Arroz 1kg', TasaIva.CERO),
    ]);
    expect(motivo).toBe(
      'Antes de facturar hay que elegir el IVA (0 % o 16 %) en Productos de: Agua mineral.',
    );
  });
});
