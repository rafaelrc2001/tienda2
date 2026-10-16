import { CatalogoSatService } from './catalogo-sat.service';

/** Contra los .tsv reales de `catalogos-sat/`: si el SAT cambia algo, se nota aqui. */
describe('CatalogoSatService', () => {
  const catalogo = new CatalogoSatService();
  beforeAll(() => catalogo.cargar());

  it('carga los dos catalogos', () => {
    expect(catalogo.disponible).toBe(true);
    expect(catalogo.productoServicio('24122002')?.descripcion).toBe('Botellas de plástico');
    expect(catalogo.unidad('H87')?.nombre).toBe('Pieza');
  });

  it('busca por palabras sin importar acentos ni mayusculas', () => {
    const r = catalogo.buscarProductos('BOTELLAS plastico');
    expect(r[0].clave).toBe('24122002');
  });

  it('encuentra por palabras similares del SAT', () => {
    expect(catalogo.buscarProductos('jitomate').map((p) => p.clave)).toContain('50406500');
  });

  it('una clave escrita va primero, y sus hijas en orden', () => {
    expect(catalogo.buscarProductos('24122002')[0].clave).toBe('24122002');
    const familia = catalogo.buscarProductos('241220').map((p) => p.clave);
    expect(familia).toEqual([...familia].sort());
  });

  it('sin texto no devuelve claves de producto pero si las unidades comunes', () => {
    expect(catalogo.buscarProductos('  ')).toEqual([]);
    expect(catalogo.buscarUnidades('')[0].clave).toBe('H87');
  });

  it('valida y normaliza lo que llega de un formulario o de un Excel', () => {
    expect(catalogo.validarClaveProdServ('1010101')).toEqual({ clave: '01010101' });
    expect(catalogo.validarClaveProdServ('')).toEqual({ clave: null });
    expect(catalogo.validarClaveProdServ('99999999')).toHaveProperty('motivo');
    expect(catalogo.validarClaveUnidad('kgm')).toEqual({ clave: 'KGM' });
    expect(catalogo.validarClaveUnidad('ZZZ')).toHaveProperty('motivo');
  });
});
