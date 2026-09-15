import { Cliente, MetodoEntrega } from '@prisma/client';
import { DireccionEntregaDto } from './dto/carrito.dto';
import { PedidosService } from './pedidos.service';

// Es privada: se prueba por indice para no abrirla solo por la prueba.
const direccionParaPerfil = PedidosService['direccionParaPerfil'];

/** Solo importan los campos de direccion; el resto del cliente no se lee. */
const cliente = (datos: Partial<Cliente> = {}) =>
  ({ calle: null, quienRecibe: null, ...datos }) as Cliente;

const direccion = {
  quienRecibe: ' Maria Lopez ',
  telefono: '9931234567',
  calle: ' Av. Gregorio Mendez 123 ',
  colonia: 'Centro',
  cp: '86000',
  ciudad: 'Villahermosa',
  estado: '  ',
  referencias: 'Porton verde',
  lat: 17.98,
  lng: -92.93,
} as DireccionEntregaDto;

describe('PedidosService.direccionParaPerfil', () => {
  it('llena el perfil vacio con la direccion del pedido', () => {
    expect(direccionParaPerfil(cliente(), MetodoEntrega.DOMICILIO, direccion)).toEqual({
      quienRecibe: 'Maria Lopez',
      calle: 'Av. Gregorio Mendez 123',
      colonia: 'Centro',
      cp: '86000',
      ciudad: 'Villahermosa',
      estado: null,
      referencias: 'Porton verde',
      lat: 17.98,
      lng: -92.93,
    });
  });

  it('no copia el telefono: el del perfil es el de login', () => {
    const datos = direccionParaPerfil(cliente(), MetodoEntrega.DOMICILIO, direccion);
    expect(datos).not.toHaveProperty('telefono');
  });

  it('respeta quien recibe si el perfil ya lo tenia', () => {
    const datos = direccionParaPerfil(
      cliente({ quienRecibe: 'Juan Perez' }),
      MetodoEntrega.DOMICILIO,
      direccion,
    );
    expect(datos.quienRecibe).toBeUndefined();
    expect(datos.calle).toBe('Av. Gregorio Mendez 123');
  });

  it('no pisa una direccion ya guardada', () => {
    expect(
      direccionParaPerfil(cliente({ calle: 'Calle 5 #10' }), MetodoEntrega.DOMICILIO, direccion),
    ).toEqual({});
  });

  it('una calle en blanco cuenta como perfil vacio', () => {
    const datos = direccionParaPerfil(
      cliente({ calle: '   ' }),
      MetodoEntrega.DOMICILIO,
      direccion,
    );
    expect(datos.calle).toBe('Av. Gregorio Mendez 123');
  });

  it('recoger en tienda no toca el perfil', () => {
    expect(direccionParaPerfil(cliente(), MetodoEntrega.TIENDA, direccion)).toEqual({});
  });

  it('sin direccion no toca el perfil', () => {
    expect(direccionParaPerfil(cliente(), MetodoEntrega.DOMICILIO, undefined)).toEqual({});
  });
});
