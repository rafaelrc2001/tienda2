/**
 * Baja del SAT los catalogos del CFDI 4.0 y deja en `catalogos-sat/` las dos
 * listas que usa el panel de productos: c_ClaveProdServ y c_ClaveUnidad.
 *
 *   npm run sat:catalogos                       # la version vigente del Anexo 20
 *   npm run sat:catalogos -- ruta/catCFDI.xls   # un archivo ya descargado
 *
 * Se corre a mano cuando el SAT publica una version nueva (unas pocas veces al
 * anio) y los archivos que genera se suben al repo. No lo hace la API sola a
 * proposito: el .xls del SAT pesa ~50 MB y leerlo ocupa mas de 1 GB de memoria,
 * mas de lo que tiene el servidor. Los .tsv que salen pesan unos MB y la API
 * los carga al arrancar (`catalogo-sat.service.ts`).
 *
 * Solo se guardan las claves vigentes: las que tienen fecha de fin de vigencia
 * ya no se pueden usar en un CFDI nuevo.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as XLSX from 'xlsx';

const PAGINA_ANEXO_20 = 'http://omawww.sat.gob.mx/tramitesyservicios/Paginas/anexo_20.htm';
const DESTINO = join(__dirname, '..', 'catalogos-sat');

type Fila = (string | number)[];

async function descargarVigente(): Promise<{ nombre: string; contenido: Buffer }> {
  const pagina = await (await fetch(PAGINA_ANEXO_20)).text();
  // La pagina enlaza tambien los catalogos del CFDI 3.3; se quiere el del 4.0.
  const enlace = pagina.match(/href="([^"]*catCFDI_V_4_\d+\.xls)"/i)?.[1];
  if (!enlace) throw new Error(`No se encontro el catalogo del CFDI 4.0 en ${PAGINA_ANEXO_20}`);
  const url = new URL(enlace, PAGINA_ANEXO_20).toString();
  console.log(`Descargando ${url}`);
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`El SAT respondio ${respuesta.status} al bajar ${url}`);
  return { nombre: basename(url), contenido: Buffer.from(await respuesta.arrayBuffer()) };
}

/**
 * Las filas de datos de una hoja. Cada hoja del SAT trae arriba el titulo, la
 * version del catalogo y una fila de encabezados que empieza con el nombre de
 * la hoja; los datos son lo que sigue. Un catalogo largo viene partido en
 * varias hojas (`_Parte_1`, `_Parte_2`) con el mismo encabezado.
 */
function filasDe(libro: XLSX.WorkBook, catalogo: string): Fila[] {
  const hojas = libro.SheetNames.filter(
    (n) =>
      n.toLowerCase() === catalogo.toLowerCase() ||
      n.toLowerCase().startsWith(`${catalogo.toLowerCase()}_parte`),
  );
  if (hojas.length === 0) throw new Error(`El archivo no trae la hoja ${catalogo}`);
  const filas: Fila[] = [];
  for (const hoja of hojas) {
    const todas = XLSX.utils.sheet_to_json<Fila>(libro.Sheets[hoja], { header: 1, defval: '' });
    const encabezado = todas.findIndex((f) => String(f[0]).trim() === catalogo);
    if (encabezado < 0) throw new Error(`La hoja ${hoja} no tiene el encabezado ${catalogo}`);
    filas.push(...todas.slice(encabezado + 1).filter((f) => String(f[0]).trim() !== ''));
  }
  return filas;
}

/** Sin tabuladores ni saltos de linea: rompen el .tsv. */
function limpio(valor: string | number | undefined): string {
  return String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Las claves numericas llegan como numero y pierden el cero inicial. */
function clave(valor: string | number, largo: number): string {
  const texto = limpio(valor);
  return /^\d+$/.test(texto) ? texto.padStart(largo, '0') : texto;
}

function escribir(archivo: string, fuente: string, columnas: string[], filas: string[][]): void {
  const lineas = [
    `# ${fuente} · ${new Date().toISOString().slice(0, 10)} · npm run sat:catalogos`,
    columnas.join('\t'),
    ...filas.map((f) => f.join('\t')),
  ];
  writeFileSync(join(DESTINO, archivo), `${lineas.join('\n')}\n`, 'utf8');
  console.log(`${archivo}: ${filas.length} claves vigentes`);
}

async function main(): Promise<void> {
  const ruta = process.argv[2];
  const { nombre, contenido } = ruta
    ? { nombre: basename(ruta), contenido: readFileSync(ruta) }
    : await descargarVigente();

  console.log(`Leyendo ${nombre} (tarda unos segundos)…`);
  const libro = XLSX.read(contenido, { type: 'buffer', dense: true });
  mkdirSync(DESTINO, { recursive: true });

  // c_ClaveProdServ | Descripcion | IVA | IEPS | Complemento | Inicio | Fin | Franja | Palabras similares
  const productos = filasDe(libro, 'c_ClaveProdServ')
    .filter((f) => limpio(f[6]) === '')
    .map((f) => [clave(f[0], 8), limpio(f[1]), limpio(f[8])]);
  escribir('c_ClaveProdServ.tsv', nombre, ['clave', 'descripcion', 'similares'], productos);

  // c_ClaveUnidad | Nombre | Descripcion | Nota | Inicio | Fin | Simbolo
  const unidades = filasDe(libro, 'c_ClaveUnidad')
    .filter((f) => limpio(f[5]) === '')
    .map((f) => [clave(f[0], 2), limpio(f[1]), limpio(f[6])]);
  escribir('c_ClaveUnidad.tsv', nombre, ['clave', 'nombre', 'simbolo'], unidades);
}

main().catch((fallo: unknown) => {
  console.error(fallo instanceof Error ? fallo.message : fallo);
  process.exit(1);
});
