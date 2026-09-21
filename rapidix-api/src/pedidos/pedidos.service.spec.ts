import { MetodoEntrega } from '@prisma/client';
import { DireccionEntregaDto } from './dto/carrito.dto';
import { PedidosService } from './pedidos.service';

// Es privada: se prueba por indice para no abrirla solo por la prueba.
const direccionParaPerfil = PedidosService['direccionParaPerfil'];

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
  it('la direccion del pedido pasa al perfil, aunque ya tuviera una', () => {
    expect(direccionParaPerfil(MetodoEntrega.DOMICILIO, direccion)).toEqual({
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
    const datos = direccionParaPerfil(MetodoEntrega.DOMICILIO, direccion);
    expect(datos).not.toHaveProperty('telefono');
  });

  it('recoger en tienda no toca el perfil', () => {
    expect(direccionParaPerfil(MetodoEntrega.TIENDA, direccion)).toEqual({});
  });

  it('sin direccion no toca el perfil', () => {
    expect(direccionParaPerfil(MetodoEntrega.DOMICILIO, undefined)).toEqual({});
  });
});
