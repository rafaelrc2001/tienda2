import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ActualizarProductoDto } from './producto.dto';

/** Lo que dice la validacion de un `precioVenta` llegado por JSON. */
async function rechaza(json: string): Promise<boolean> {
  const cuerpo = JSON.parse(`{"precioVenta":${json}}`) as object;
  const errores = await validate(plainToInstance(ActualizarProductoDto, cuerpo));
  return errores.length > 0;
}

describe('EsPrecio', () => {
  it('acepta hasta quince decimales', async () => {
    expect(await rechaza('3.333333333333333')).toBe(false);
    expect(await rechaza('12.5')).toBe(false);
    expect(await rechaza('10')).toBe(false);
  });

  it('rechaza mas de quince decimales', async () => {
    expect(await rechaza('1.1234567890123456')).toBe(true);
  });

  it('un numero con exponente se valida sin reventar', async () => {
    expect(await rechaza('0.0000001')).toBe(false);
    expect(await rechaza('1e-16')).toBe(true);
  });

  it('rechaza lo que no es un numero y los negativos', async () => {
    expect(await rechaza('"abc"')).toBe(true);
    expect(await rechaza('-1')).toBe(true);
  });
});
