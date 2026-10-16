import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Los catalogos oficiales del SAT para clasificar productos: c_ClaveProdServ
 * (~52 mil claves) y c_ClaveUnidad (~2,400).
 *
 * Viven en memoria, leidos al arrancar de `catalogos-sat/*.tsv`, que genera
 * `npm run sat:catalogos` desde el .xls del SAT. No van a la base: no los
 * edita nadie, cambian solo cuando el SAT publica otra version, y buscar en
 * un arreglo de 52 mil textos ya normalizados tarda unos milisegundos.
 *
 * La ruta sale de `__dirname` y no de `process.cwd()`: desde `src/facturacion`
 * (pruebas) y desde `dist/facturacion` (produccion) la carpeta queda dos
 * niveles arriba.
 */
const CARPETA = join(__dirname, '..', '..', 'catalogos-sat');

/** Tope de resultados por busqueda: es una lista para elegir, no un listado. */
const LIMITE = 40;

export interface ClaveProdServ {
  clave: string;
  descripcion: string;
  /** "Palabras similares" del SAT: sinonimos con los que tambien se encuentra. */
  similares: string;
}

export interface ClaveUnidad {
  clave: string;
  nombre: string;
  simbolo: string;
}

/**
 * Las unidades que usa un abarrote. Con el buscador vacio se ofrecen estas:
 * entre 2,400 claves (barriles, quilates, ascensores) las utiles se pierden.
 */
const UNIDADES_FRECUENTES = [
  'H87',
  'KGM',
  'GRM',
  'LTR',
  'MLT',
  'XBX',
  'XPK',
  'XBO',
  'XBG',
  'XKI',
  'E48',
];

interface Indexada<T> {
  item: T;
  /** Clave + textos, sin acentos y en minusculas: es contra lo que se busca. */
  texto: string;
  /** Solo la descripcion o el nombre, normalizado: pesa mas que los sinonimos. */
  principal: string;
}

@Injectable()
export class CatalogoSatService implements OnModuleInit {
  private readonly logger = new Logger(CatalogoSatService.name);
  private productos: Indexada<ClaveProdServ>[] = [];
  private unidades: Indexada<ClaveUnidad>[] = [];
  private readonly porClaveProducto = new Map<string, ClaveProdServ>();
  private readonly porClaveUnidad = new Map<string, ClaveUnidad>();

  onModuleInit(): void {
    this.cargar();
  }

  /**
   * Sin los archivos la API arranca igual: los productos se guardan sin clave
   * y la factura usa la generica. Se avisa fuerte en el log.
   */
  cargar(): void {
    try {
      for (const [clave, descripcion, similares] of leerTsv('c_ClaveProdServ.tsv')) {
        const item = { clave, descripcion, similares: similares ?? '' };
        this.porClaveProducto.set(clave, item);
        this.productos.push({
          item,
          texto: normalizar(`${clave} ${descripcion} ${item.similares}`),
          principal: normalizar(descripcion),
        });
      }
      for (const [clave, nombre, simbolo] of leerTsv('c_ClaveUnidad.tsv')) {
        const item = { clave, nombre, simbolo: simbolo ?? '' };
        this.porClaveUnidad.set(clave, item);
        this.unidades.push({
          item,
          texto: normalizar(`${clave} ${nombre} ${item.simbolo}`),
          principal: normalizar(nombre),
        });
      }
      this.logger.log(
        `Catalogos del SAT: ${this.productos.length} claves de producto, ${this.unidades.length} de unidad`,
      );
    } catch (fallo) {
      this.productos = [];
      this.unidades = [];
      this.porClaveProducto.clear();
      this.porClaveUnidad.clear();
      this.logger.error(
        `No se pudieron leer los catalogos del SAT de ${CARPETA}: ${String(fallo)}. ` +
          'Corre `npm run sat:catalogos`.',
      );
    }
  }

  get disponible(): boolean {
    return this.productos.length > 0;
  }

  productoServicio(clave: string): ClaveProdServ | null {
    return this.porClaveProducto.get(clave) ?? null;
  }

  /**
   * Casi todas las claves de unidad van en mayusculas, pero el SAT tiene
   * unas pocas mixtas ("Ohm", "Dx"): se respeta la exacta y, si no, se acepta
   * escrita en otras mayusculas, que es como llega de un Excel.
   */
  unidad(clave: string): ClaveUnidad | null {
    const exacta = this.porClaveUnidad.get(clave);
    if (exacta) return exacta;
    const buscada = clave.toUpperCase();
    return this.unidades.find((u) => u.item.clave.toUpperCase() === buscada)?.item ?? null;
  }

  /**
   * La clave de producto tal como se guarda, o por que no vale. Vacia es
   * `null`: quitarla. Un Excel convierte "01010101" en el numero 1010101, asi
   * que se le devuelven los ceros. Sin catalogo cargado basta con el formato:
   * no se bloquea el alta de productos por un archivo que falta.
   */
  validarClaveProdServ(texto: string): { clave: string | null } | { motivo: string } {
    const limpia = texto.trim();
    if (!limpia) return { clave: null };
    const clave = /^\d{1,8}$/.test(limpia) ? limpia.padStart(8, '0') : limpia;
    if (!/^\d{8}$/.test(clave)) {
      return { motivo: `La clave SAT «${limpia}» no es válida: son 8 dígitos` };
    }
    if (this.disponible && !this.porClaveProducto.has(clave)) {
      return { motivo: `La clave SAT ${clave} no existe en el catálogo vigente del SAT` };
    }
    return { clave };
  }

  /** Igual, para la clave de unidad. Se guarda escrita como en el catalogo. */
  validarClaveUnidad(texto: string): { clave: string | null } | { motivo: string } {
    const limpia = texto.trim();
    if (!limpia) return { clave: null };
    if (!/^[A-Za-z0-9]{1,3}$/.test(limpia)) {
      return {
        motivo: `La clave de unidad «${limpia}» no es válida: son hasta 3 letras o números`,
      };
    }
    if (!this.disponible) return { clave: limpia.toUpperCase() };
    const unidad = this.unidad(limpia);
    if (!unidad) {
      return { motivo: `La clave de unidad ${limpia} no existe en el catálogo vigente del SAT` };
    }
    return { clave: unidad.clave };
  }

  /** Buscador de «Clave SAT». Vacio no devuelve nada: 52 mil claves no se hojean. */
  buscarProductos(q: string): ClaveProdServ[] {
    return buscar(this.productos, q);
  }

  /** Buscador de «Clave de unidad». Vacio devuelve las de un abarrote. */
  buscarUnidades(q: string): ClaveUnidad[] {
    if (!q.trim()) {
      return UNIDADES_FRECUENTES.map((c) => this.porClaveUnidad.get(c)).filter(
        (u): u is ClaveUnidad => u !== undefined,
      );
    }
    return buscar(this.unidades, q);
  }
}

function leerTsv(archivo: string): string[][] {
  return readFileSync(join(CARPETA, archivo), 'utf8')
    .split('\n')
    .filter((linea) => linea.trim() !== '' && !linea.startsWith('#'))
    .slice(1) // encabezados
    .map((linea) => linea.replace(/\r$/, '').split('\t'));
}

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Todas las palabras tienen que aparecer (en la clave, la descripcion o los
 * sinonimos). El orden: la clave exacta, luego las claves que empiezan asi
 * (para escribir "2412" y bajar por la familia), luego las descripciones que
 * empiezan con lo escrito, luego las que lo tienen en la descripcion y al
 * final las que solo coinciden por un sinonimo. Dentro de cada grupo, la
 * descripcion mas corta primero: «Botellas» antes que «Botellas de vidrio
 * para laboratorio».
 */
function buscar<T extends { clave: string }>(lista: Indexada<T>[], q: string): T[] {
  const consulta = normalizar(q.trim());
  const palabras = consulta.split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];

  const puntaje = (e: Indexada<T>): number => {
    const clave = e.item.clave.toLowerCase();
    if (clave === consulta) return 0;
    if (clave.startsWith(consulta)) return 1;
    if (e.principal.startsWith(consulta)) return 2;
    if (palabras.every((p) => e.principal.includes(p))) return 3;
    return 4;
  };

  return lista
    .filter((e) => palabras.every((p) => e.texto.includes(p)))
    .map((e) => ({ e, p: puntaje(e) }))
    .sort(
      (a, b) =>
        a.p - b.p ||
        (a.p === 1
          ? a.e.item.clave.localeCompare(b.e.item.clave)
          : a.e.principal.length - b.e.principal.length),
    )
    .slice(0, LIMITE)
    .map(({ e }) => e.item);
}
