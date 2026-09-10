import { BadRequestException, Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriasService } from './categorias.service';
import { escalonesAColumnas, validarEscalones } from './precios';

/** Columnas del Word 6.6. */
export const COLUMNAS_REQUERIDAS = [
  'Categoria',
  'Producto',
  'Unidad',
  'Precio de costo',
  'Precio de venta',
] as const;
export const COLUMNA_OPCIONAL = 'Imagen';

/** Listas de precio por volumen (HU-08). La lista 1 es el precio de venta. */
export const COLUMNAS_LISTAS = ['Piso 2', 'Precio 2', 'Piso 3', 'Precio 3'] as const;
/** Si el producto suma a la base del cashback (HU-12). Si / No. */
export const COLUMNA_CASHBACK = 'Aplica cashback';

export const COLUMNAS_OPCIONALES = [COLUMNA_OPCIONAL, ...COLUMNAS_LISTAS, COLUMNA_CASHBACK];

type BufferDeExcelJs = Parameters<Workbook['xlsx']['load']>[0];

export type ResultadoFila =
  | { fila: number; estado: 'creado'; producto: string }
  | { fila: number; estado: 'actualizado'; producto: string }
  | { fila: number; estado: 'error'; motivo: string };

export interface ResumenImportacion {
  total: number;
  creados: number;
  actualizados: number;
  errores: number;
  /** Categorias que no existian y quedaron dadas de alta en el catalogo. */
  categoriasNuevas: string[];
  filas: ResultadoFila[];
}

interface FilaLeida {
  numero: number;
  categoria: string;
  producto: string;
  unidad: string;
  precioCosto: string;
  precioVenta: string;
  imagen: string;
  piso2: string;
  precio2: string;
  piso3: string;
  precio3: string;
  aplicaCashback: string;
  /**
   * El archivo trae las columnas de listas. Sin ellas no se tocan las listas
   * que ya tuviera el producto: un Excel viejo, de antes del precio
   * escalonado, no debe borrarlas por no mencionarlas.
   */
  conListas: boolean;
  /** Lo mismo con la columna de cashback. */
  conCashback: boolean;
}

@Injectable()
export class ImportacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categorias: CategoriasService,
  ) {}

  /**
   * Normaliza un encabezado para compararlo: sin acentos, sin mayusculas y
   * sin espacios de mas. Asi "PRECIO DE VENTA" y "Precio de Venta" valen igual.
   */
  private static normalizar(texto: string): string {
    return texto
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /** Convierte "1,234.50", "$18" o 18 en un numero. Devuelve null si no lo es. */
  private static aNumero(valor: string): number | null {
    const limpio = valor.replace(/[$\s,]/g, '');
    if (limpio === '') return null;
    const n = Number(limpio);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * "Si" / "No" de la columna de cashback. `undefined` si la celda esta vacia
   * —no se toca lo que hubiera— y `null` si no se entiende.
   */
  private static aBooleano(valor: string): boolean | null | undefined {
    const limpio = ImportacionService.normalizar(valor);
    if (limpio === '') return undefined;
    if (['si', 's', 'x', '1', 'true', 'verdadero'].includes(limpio)) return true;
    if (['no', 'n', '0', 'false', 'falso'].includes(limpio)) return false;
    return null;
  }

  /**
   * Listas de volumen de una fila. Una lista con piezas pero sin precio, o al
   * reves, es un error: adivinar la mitad que falta seria inventar un precio.
   */
  private static leerListas(fila: FilaLeida): { piso: number; precio: number }[] | string {
    const escalones: { piso: number; precio: number }[] = [];
    const listas = [
      [2, fila.piso2, fila.precio2],
      [3, fila.piso3, fila.precio3],
    ] as const;

    for (const [lista, pisoTexto, precioTexto] of listas) {
      if (!pisoTexto && !precioTexto) continue;
      const piso = ImportacionService.aNumero(pisoTexto);
      const precio = ImportacionService.aNumero(precioTexto);
      if (piso === null || precio === null) {
        return `La lista ${lista} necesita piezas y precio, los dos como número`;
      }
      if (lista === 3 && escalones.length === 0) {
        return 'La lista 3 necesita que antes esté la lista 2';
      }
      escalones.push({ piso, precio });
    }
    return escalones;
  }

  async importar(buffer: Buffer): Promise<ResumenImportacion> {
    const filas = await this.leerArchivo(buffer);
    const resultados: ResultadoFila[] = [];

    // La columna Categoria alimenta el catalogo: cada nombre nuevo que trae el
    // Excel queda dado de alta. El mapa evita resolver cien veces la misma
    // categoria en un archivo de cien productos.
    const conocidas = await this.categorias.listarNombres();
    const yaExistian = new Set(conocidas.map((n) => n.toLowerCase()));
    const resueltas = new Map<string, string>();
    const nuevas: string[] = [];

    for (const fila of filas) {
      resultados.push(await this.procesarFila(fila, resueltas, yaExistian, nuevas));
    }

    return {
      total: resultados.length,
      creados: resultados.filter((r) => r.estado === 'creado').length,
      actualizados: resultados.filter((r) => r.estado === 'actualizado').length,
      errores: resultados.filter((r) => r.estado === 'error').length,
      categoriasNuevas: nuevas,
      filas: resultados,
    };
  }

  /** Lee la primera hoja y mapea las columnas por su encabezado. */
  private async leerArchivo(buffer: Buffer): Promise<FilaLeida[]> {
    const libro = new Workbook();
    try {
      // exceljs empaqueta una definicion de Buffer anterior a la de Node 24;
      // el objeto en tiempo de ejecucion es el mismo, solo discrepan los tipos.
      await libro.xlsx.load(buffer as unknown as BufferDeExcelJs);
    } catch {
      throw new BadRequestException('No se pudo leer el archivo. ¿Es un .xlsx válido?');
    }

    const hoja = libro.worksheets[0];
    if (!hoja || hoja.rowCount < 2) {
      throw new BadRequestException('El archivo está vacío o no tiene filas de datos.');
    }

    // Encabezados -> indice de columna
    const indices = new Map<string, number>();
    hoja.getRow(1).eachCell((celda, columna) => {
      indices.set(ImportacionService.normalizar(String(celda.value ?? '')), columna);
    });

    const faltantes = COLUMNAS_REQUERIDAS.filter(
      (c) => !indices.has(ImportacionService.normalizar(c)),
    );
    if (faltantes.length > 0) {
      throw new BadRequestException(
        `Faltan columnas obligatorias: ${faltantes.join(', ')}. ` +
          `El archivo debe tener: ${COLUMNAS_REQUERIDAS.join(', ')} (${COLUMNAS_OPCIONALES.join(', ')} son opcionales).`,
      );
    }

    const conListas = COLUMNAS_LISTAS.some((c) => indices.has(ImportacionService.normalizar(c)));
    const conCashback = indices.has(ImportacionService.normalizar(COLUMNA_CASHBACK));

    const leerCelda = (numeroFila: number, encabezado: string): string => {
      const columna = indices.get(ImportacionService.normalizar(encabezado));
      if (!columna) return '';
      const valor = hoja.getRow(numeroFila).getCell(columna).value;
      if (valor === null || valor === undefined) return '';
      if (typeof valor === 'object' && 'result' in valor) return String(valor.result ?? '');
      if (typeof valor === 'object' && 'text' in valor) return String(valor.text ?? '');
      return String(valor).trim();
    };

    const filas: FilaLeida[] = [];
    for (let n = 2; n <= hoja.rowCount; n++) {
      const fila: FilaLeida = {
        numero: n,
        categoria: leerCelda(n, 'Categoria'),
        producto: leerCelda(n, 'Producto'),
        unidad: leerCelda(n, 'Unidad'),
        precioCosto: leerCelda(n, 'Precio de costo'),
        precioVenta: leerCelda(n, 'Precio de venta'),
        imagen: leerCelda(n, COLUMNA_OPCIONAL),
        piso2: leerCelda(n, 'Piso 2'),
        precio2: leerCelda(n, 'Precio 2'),
        piso3: leerCelda(n, 'Piso 3'),
        precio3: leerCelda(n, 'Precio 3'),
        aplicaCashback: leerCelda(n, COLUMNA_CASHBACK),
        conListas,
        conCashback,
      };
      // Fila completamente vacia: se ignora sin contarla como error.
      const vacia = !fila.categoria && !fila.producto && !fila.precioVenta;
      if (!vacia) filas.push(fila);
    }

    if (filas.length === 0) {
      throw new BadRequestException('El archivo no tiene filas de datos.');
    }
    return filas;
  }

  /**
   * Una fila invalida no aborta la importacion: se reporta y se sigue con la
   * siguiente. Un catalogo de 300 productos no puede caerse entero porque a
   * uno le falte el precio.
   */
  private async procesarFila(
    fila: FilaLeida,
    resueltas: Map<string, string>,
    yaExistian: Set<string>,
    nuevas: string[],
  ): Promise<ResultadoFila> {
    const nombre = fila.producto.trim();
    const categoria = fila.categoria.trim();

    if (!nombre) return { fila: fila.numero, estado: 'error', motivo: 'Falta el nombre del producto' };
    if (!categoria) return { fila: fila.numero, estado: 'error', motivo: 'Falta la categoría' };

    const precioVenta = ImportacionService.aNumero(fila.precioVenta);
    if (precioVenta === null) {
      return { fila: fila.numero, estado: 'error', motivo: 'El precio de venta falta o no es un número' };
    }
    if (precioVenta < 0) {
      return { fila: fila.numero, estado: 'error', motivo: 'El precio de venta no puede ser negativo' };
    }

    const precioCosto = ImportacionService.aNumero(fila.precioCosto) ?? 0;
    if (precioCosto < 0) {
      return { fila: fila.numero, estado: 'error', motivo: 'El precio de costo no puede ser negativo' };
    }

    // Misma escalera que el alta manual: pisos que suben, precios que bajan.
    const listas = fila.conListas ? ImportacionService.leerListas(fila) : null;
    if (typeof listas === 'string') return { fila: fila.numero, estado: 'error', motivo: listas };
    const motivoListas = listas ? validarEscalones(precioVenta, listas) : null;
    if (motivoListas) return { fila: fila.numero, estado: 'error', motivo: motivoListas };

    const aplicaCashback = fila.conCashback
      ? ImportacionService.aBooleano(fila.aplicaCashback)
      : undefined;
    if (aplicaCashback === null) {
      return {
        fila: fila.numero,
        estado: 'error',
        motivo: `La columna ${COLUMNA_CASHBACK} solo acepta Sí o No`,
      };
    }

    const clave = CategoriasService.limpiar(categoria).toLowerCase();
    let categoriaId = resueltas.get(clave);
    if (!categoriaId) {
      categoriaId = await this.categorias.resolver(categoria);
      resueltas.set(clave, categoriaId);
      if (!yaExistian.has(clave)) nuevas.push(CategoriasService.limpiar(categoria));
    }

    const datos = {
      unidad: fila.unidad.trim() || 'pza',
      precioCosto,
      precioVenta,
      ...(fila.imagen.trim() && { imagenUrl: fila.imagen.trim() }),
      ...(listas && escalonesAColumnas(listas)),
      ...(aplicaCashback !== undefined && { aplicaCashback }),
    };

    // Mismo nombre y misma categoria = mismo producto: se actualiza en vez de
    // duplicarse, que es como se usa una carga masiva para refrescar precios.
    const existente = await this.prisma.producto.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' }, categoriaId },
      select: { id: true },
    });

    if (existente) {
      await this.prisma.producto.update({ where: { id: existente.id }, data: datos });
      return { fila: fila.numero, estado: 'actualizado', producto: nombre };
    }

    await this.prisma.producto.create({ data: { nombre, categoriaId, ...datos } });
    return { fila: fila.numero, estado: 'creado', producto: nombre };
  }

  /**
   * Plantilla de ejemplo con las columnas correctas (Word 6.6).
   *
   * Se genera en .xlsx y no en .csv a proposito: la carga solo acepta .xlsx, y
   * una plantilla que hay que convertir antes de poder subirla no es una
   * plantilla, es un tramite.
   */
  static async generarPlantillaXlsx(): Promise<Buffer> {
    const libro = new Workbook();
    const hoja = libro.addWorksheet('Productos');

    hoja.columns = [...COLUMNAS_REQUERIDAS, ...COLUMNAS_OPCIONALES].map((encabezado) => ({
      header: encabezado,
      width: encabezado === COLUMNA_OPCIONAL ? 42 : encabezado.length > 10 ? 20 : 12,
    }));
    hoja.getRow(1).font = { bold: true };

    // El arroz lleva listas de volumen: desde 5 kg a $26.50 y desde 10 a $25.
    hoja.addRows([
      ['Frutas y Verduras', 'Tomate bola', 'kg', 9, 18, '', '', '', '', '', 'Sí'],
      ['Carnes', 'Pechuga de pollo', 'kg', 62, 89, '', '', '', '', '', 'Sí'],
      [
        'Abarrotes',
        'Arroz 1kg',
        'kg',
        19,
        28,
        'https://cdn.rapidix.mx/productos/arroz.webp',
        5,
        26.5,
        10,
        25,
        'Sí',
      ],
      ['Bebidas', 'Agua mineral', 'pza', 8, 14, '', 6, 13, 12, 12, 'No'],
    ]);

    return Buffer.from(await libro.xlsx.writeBuffer());
  }
}
