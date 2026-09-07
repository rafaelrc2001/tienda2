/**
 * Servidor estático de producción.
 *
 * Sirve `dist/` y **reescribe a `index.html`** cualquier ruta que no sea un
 * fichero: sin eso, recargar en `/admin/productos` daría 404, porque esa ruta
 * solo existe dentro del router del navegador.
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import handler from 'serve-handler'

const raiz = join(dirname(fileURLToPath(import.meta.url)), 'dist')
const puerto = Number(process.env.PORT ?? 4173)

/**
 * Los assets NO se reescriben.
 *
 * Llevan hash en el nombre: si uno no existe es que el navegador tiene un
 * index viejo en caché. Debe dar 404 y verse, no un `index.html` disfrazado
 * de JavaScript que falla con un error de MIME imposible de leer.
 */
const esAsset = (url = '') => url.startsWith('/assets/')

const servidor = createServer((peticion, respuesta) =>
  handler(peticion, respuesta, {
    public: raiz,
    cleanUrls: false,
    // Todo lo demás que no sea un fichero real acaba en index.html.
    rewrites: esAsset(peticion.url)
      ? []
      : [{ source: '**', destination: '/index.html' }],
    headers: [
      {
        // Los assets llevan hash en el nombre: se pueden cachear para siempre.
        source: 'assets/**',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // El index NO: es quien apunta a los assets nuevos tras un despliegue.
        source: 'index.html',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ],
  }),
)

servidor.listen(puerto, '0.0.0.0', () => {
  console.log(`rapidix-web sirviendo dist/ en el puerto ${puerto}`)
})
