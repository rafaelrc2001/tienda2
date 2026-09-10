/**
 * Seeds de Rapidix — SPEC 01, paso 4.
 *
 * Los datos salen del prototipo `rapidix_mockup (2).html`.
 *
 * El script es idempotente y NO destructivo:
 *  - Las tablas con clave natural (tipos de cupon, configuracion, niveles,
 *    fuentes) se escriben con `upsert`.
 *  - Las tablas de catalogo y contenido solo se llenan si estan vacias,
 *    para no duplicar ni pisar datos reales al re-ejecutarlo.
 */
import {
  PrismaClient,
  OrigenReceta,
  RolProducto,
  RolUsuario,
  TipoDescuento,
  TipoFuente,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ------------------------------------------------------------------
// Catalogo (mockup: const products)
// ------------------------------------------------------------------

const PRODUCTOS = [
  { nombre: 'Tomate bola', categoria: 'Frutas y Verduras', unidad: 'kg', precioCosto: 9, precioVenta: 18, agotado: false, rol: RolProducto.RUTINA },
  { nombre: 'Lechuga romana', categoria: 'Frutas y Verduras', unidad: 'pza', precioCosto: 8, precioVenta: 15, agotado: false, rol: RolProducto.RUTINA },
  { nombre: 'Aguacate hass', categoria: 'Frutas y Verduras', unidad: 'kg', precioCosto: 14, precioVenta: 22, agotado: true, rol: RolProducto.DESTINO },
  { nombre: 'Limón', categoria: 'Frutas y Verduras', unidad: 'kg', precioCosto: 6, precioVenta: 12, agotado: false, rol: RolProducto.CONVENIENCIA },
  { nombre: 'Pechuga de pollo', categoria: 'Carnes', unidad: 'kg', precioCosto: 62, precioVenta: 89, agotado: false, rol: RolProducto.DESTINO },
  { nombre: 'Carne molida de res', categoria: 'Carnes', unidad: 'kg', precioCosto: 78, precioVenta: 110, agotado: false, rol: RolProducto.DESTINO },
  { nombre: 'Leche entera 1L', categoria: 'Lácteos', unidad: 'L', precioCosto: 16, precioVenta: 24, piso2: 6, precio2: 22.5, agotado: false, rol: RolProducto.RUTINA },
  { nombre: 'Queso panela', categoria: 'Lácteos', unidad: 'pza', precioCosto: 40, precioVenta: 58, agotado: true, rol: RolProducto.RUTINA },
  { nombre: 'Arroz 1kg', categoria: 'Abarrotes', unidad: 'kg', precioCosto: 19, precioVenta: 28, piso2: 5, precio2: 26.5, piso3: 10, precio3: 25, agotado: false, rol: RolProducto.RUTINA },
  { nombre: 'Frijol negro 1kg', categoria: 'Abarrotes', unidad: 'kg', precioCosto: 22, precioVenta: 32, agotado: false, rol: RolProducto.RUTINA },
  { nombre: 'Aceite vegetal 1L', categoria: 'Abarrotes', unidad: 'L', precioCosto: 32, precioVenta: 45, agotado: false, rol: RolProducto.CONVENIENCIA },
  { nombre: 'Agua mineral', categoria: 'Bebidas', unidad: 'pza', precioCosto: 8, precioVenta: 14, piso2: 6, precio2: 13, piso3: 12, precio3: 12, aplicaCashback: false, agotado: false, rol: RolProducto.CONVENIENCIA },
  { nombre: 'Jugo natural de naranja', categoria: 'Bebidas', unidad: 'L', precioCosto: 13, precioVenta: 20, agotado: false, rol: RolProducto.ESTACIONAL },
];

/**
 * Orden en que se ven las familias en la Tienda. Es el orden en que se recorre
 * una tienda de barrio: primero por lo que se viene, al final lo que se anade
 * al pasar por la caja. El negocio lo cambia desde Productos -> Familias.
 */
const PRIORIDAD_FAMILIA: Record<string, number> = {
  Carnes: 1,
  'Frutas y Verduras': 2,
  Lácteos: 3,
  Abarrotes: 4,
  Bebidas: 7,
};

// ------------------------------------------------------------------
// Recetario (mockup: let recipes) — 6 oficiales + 2 de comunidad
// ------------------------------------------------------------------

type SeedReceta = {
  nombre: string;
  tiempo: string;
  porciones: number;
  youtube: string | null;
  categorias: string[];
  autorNombre: string;
  origin: OrigenReceta;
  compartir: boolean;
  emoji: string;
  ingredientes: { nombre: string; cantidad: string }[];
  pasos: string[];
};

const RECETAS: SeedReceta[] = [
  {
    nombre: 'Hot cakes de avena',
    tiempo: '20 min',
    porciones: 4,
    youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    categorias: ['desayuno'],
    autorNombre: 'Rapidix',
    origin: OrigenReceta.RECETARIO,
    compartir: false,
    emoji: '🥞',
    ingredientes: [
      { nombre: 'Avena molida', cantidad: '1 taza' },
      { nombre: 'Huevo', cantidad: '2 pzas' },
      { nombre: 'Plátano maduro', cantidad: '1 pza' },
      { nombre: 'Leche', cantidad: '1/2 taza' },
      { nombre: 'Polvo para hornear', cantidad: '1 cdta' },
    ],
    pasos: [
      'Mezcla la avena molida con el huevo y el plátano machacado.',
      'Agrega la leche y el polvo para hornear, integra bien.',
      'Vierte porciones en un sartén antiadherente caliente.',
      'Cocina 2 minutos por lado hasta dorar.',
    ],
  },
  {
    nombre: 'Chilaquiles verdes',
    tiempo: '25 min',
    porciones: 3,
    youtube: null,
    categorias: ['desayuno'],
    autorNombre: 'Rapidix',
    origin: OrigenReceta.RECETARIO,
    compartir: false,
    emoji: '🌶️',
    ingredientes: [
      { nombre: 'Totopos', cantidad: '3 tazas' },
      { nombre: 'Tomatillo', cantidad: '6 pzas' },
      { nombre: 'Chile serrano', cantidad: '2 pzas' },
      { nombre: 'Crema', cantidad: '1/4 taza' },
      { nombre: 'Queso fresco', cantidad: '100 g' },
    ],
    pasos: [
      'Hierve el tomatillo y el chile serrano hasta que cambien de color.',
      'Licúa con un poco de agua hasta obtener una salsa tersa.',
      'Baña los totopos con la salsa caliente.',
      'Sirve con crema, queso y cebolla al gusto.',
    ],
  },
  {
    nombre: 'Pollo a la plancha con ensalada',
    tiempo: '30 min',
    porciones: 2,
    youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    categorias: ['comida'],
    autorNombre: 'Rapidix',
    origin: OrigenReceta.RECETARIO,
    compartir: false,
    emoji: '🍗',
    ingredientes: [
      { nombre: 'Pechuga de pollo', cantidad: '2 pzas' },
      { nombre: 'Berros', cantidad: '2 tazas' },
      { nombre: 'Jitomate cherry', cantidad: '1 taza' },
      { nombre: 'Ajo', cantidad: '2 dientes' },
      { nombre: 'Aceite de oliva', cantidad: '2 cdas' },
    ],
    pasos: [
      'Sazona la pechuga con sal, pimienta y ajo picado.',
      'Sella en la plancha caliente 6 minutos por lado.',
      'Mezcla los berros con el jitomate cherry y el aceite de oliva.',
      'Sirve el pollo sobre la ensalada fresca.',
    ],
  },
  {
    nombre: 'Sopa de lentejas',
    tiempo: '40 min',
    porciones: 6,
    youtube: null,
    categorias: ['comida'],
    autorNombre: 'Rapidix',
    origin: OrigenReceta.RECETARIO,
    compartir: false,
    emoji: '🍲',
    ingredientes: [
      { nombre: 'Lentejas', cantidad: '2 tazas' },
      { nombre: 'Zanahoria', cantidad: '2 pzas' },
      { nombre: 'Papa', cantidad: '2 pzas' },
      { nombre: 'Cebolla', cantidad: '1/2 pza' },
      { nombre: 'Jitomate', cantidad: '2 pzas' },
    ],
    pasos: [
      'Sofríe la cebolla, el ajo y el jitomate picados.',
      'Agrega las lentejas, la zanahoria y la papa en cubos.',
      'Cubre con agua y deja hervir.',
      'Cocina 30 minutos a fuego medio hasta que las lentejas estén suaves.',
    ],
  },
  {
    nombre: 'Quesadillas de la abuela',
    tiempo: '15 min',
    porciones: 4,
    youtube: null,
    categorias: ['cena'],
    autorNombre: 'Rapidix',
    origin: OrigenReceta.RECETARIO,
    compartir: false,
    emoji: '🫓',
    ingredientes: [
      { nombre: 'Tortillas de maíz', cantidad: '8 pzas' },
      { nombre: 'Queso Oaxaca', cantidad: '200 g' },
      { nombre: 'Flor de calabaza', cantidad: '1 taza' },
    ],
    pasos: [
      'Rellena las tortillas con queso Oaxaca y flor de calabaza.',
      'Dobla por la mitad y calienta el comal.',
      'Cocina de ambos lados hasta que el queso funda.',
    ],
  },
  {
    nombre: 'Sincronizadas',
    tiempo: '12 min',
    porciones: 2,
    youtube: null,
    categorias: ['cena'],
    autorNombre: 'Rapidix',
    origin: OrigenReceta.RECETARIO,
    compartir: false,
    emoji: '🥪',
    ingredientes: [
      { nombre: 'Tortillas de harina', cantidad: '4 pzas' },
      { nombre: 'Jamón', cantidad: '4 rebanadas' },
      { nombre: 'Queso manchego', cantidad: '4 rebanadas' },
    ],
    pasos: [
      'Coloca jamón y queso entre dos tortillas de harina.',
      'Cocina en comal a fuego medio.',
      'Voltea hasta dorar y que el queso derrita.',
    ],
  },
  {
    nombre: 'Tacos de canasta',
    tiempo: '50 min',
    porciones: 8,
    youtube: 'https://youtu.be/dQw4w9WgXcQ',
    categorias: ['comida'],
    autorNombre: 'Marta G.',
    origin: OrigenReceta.COMUNIDAD,
    compartir: true,
    emoji: '🌮',
    ingredientes: [
      { nombre: 'Tortillas de maíz', cantidad: '20 pzas' },
      { nombre: 'Papa cocida', cantidad: '4 pzas' },
      { nombre: 'Chicharrón prensado', cantidad: '200 g' },
      { nombre: 'Aceite con achiote', cantidad: '1/2 taza' },
    ],
    pasos: [
      'Rellena las tortillas con papa y chicharrón guisados.',
      'Apila las tortillas en la canasta forrada con manta.',
      'Baña con el aceite especiado.',
      'Deja reposar 20 minutos antes de servir.',
    ],
  },
  {
    nombre: 'Avena con fruta de temporada',
    tiempo: '10 min',
    porciones: 1,
    youtube: null,
    categorias: ['desayuno'],
    autorNombre: 'Luis P.',
    origin: OrigenReceta.COMUNIDAD,
    compartir: true,
    emoji: '🍓',
    ingredientes: [
      { nombre: 'Avena', cantidad: '1/2 taza' },
      { nombre: 'Leche', cantidad: '1 taza' },
      { nombre: 'Fresas', cantidad: '5 pzas' },
      { nombre: 'Miel', cantidad: '1 cda' },
    ],
    pasos: [
      'Cocina la avena en la leche a fuego bajo por 5 minutos.',
      'Pica las fresas en cubos pequeños.',
      'Sirve la avena y decora con la fruta, miel y canela al gusto.',
    ],
  },
];

// ------------------------------------------------------------------
// Motor de cupones (mockup: lifecycleCouponTypes, fuentes)
// ------------------------------------------------------------------

const TIPOS_CICLO_VIDA = [
  {
    code: 'WELCOME',
    name: 'WELCOME',
    title: '¡Bienvenido a Rapidix!',
    description: 'Incentivo para la primera compra de un cliente nuevo.',
    customerMessage: '¡Gracias por unirte a Rapidix! Usa este cupón en tu primera compra.',
    discountType: TipoDescuento.FIXED,
    discountValue: 50,
    minimumOrderAmount: 150,
    maximumOrderAmount: null,
    validityDays: 30,
    usageLimitPerCustomer: 1,
    inactivityDays: null,
    birthdayWindowDays: null,
  },
  {
    code: 'SECOND_PURCHASE',
    name: 'SECOND_PURCHASE',
    title: 'Vuelve por más',
    description: 'Incentivo para la segunda compra, tras confirmar la primera.',
    customerMessage: '¡Tu segunda compra tiene premio! Aprovecha este cupón.',
    discountType: TipoDescuento.FIXED,
    discountValue: 30,
    minimumOrderAmount: 100,
    maximumOrderAmount: null,
    validityDays: 15,
    usageLimitPerCustomer: 1,
    inactivityDays: null,
    birthdayWindowDays: null,
  },
  {
    code: 'TICKET_INCREASE',
    name: 'TICKET_INCREASE',
    title: 'Compra más, ahorra más',
    description: 'Incentivo para incrementar el valor del ticket de compra.',
    customerMessage: 'Compra $1,000 o más y recibe $100 de descuento.',
    discountType: TipoDescuento.FIXED,
    discountValue: 100,
    minimumOrderAmount: 1000,
    maximumOrderAmount: null,
    validityDays: 30,
    usageLimitPerCustomer: 1,
    inactivityDays: null,
    birthdayWindowDays: null,
  },
  {
    code: 'INACTIVITY',
    name: 'INACTIVITY',
    title: 'Te extrañamos 👋',
    description: 'Beneficio automático para recuperar clientes inactivos.',
    customerMessage: 'Hace tiempo que no te vemos. Regresa esta semana y recibe $100 OFF.',
    discountType: TipoDescuento.FIXED,
    discountValue: 100,
    minimumOrderAmount: 0,
    maximumOrderAmount: null,
    validityDays: 7,
    usageLimitPerCustomer: 1,
    inactivityDays: 30,
    birthdayWindowDays: null,
  },
  {
    code: 'BIRTHDAY',
    name: 'BIRTHDAY',
    title: '¡Feliz cumpleaños!',
    description: 'Beneficio automático de cumpleaños, una vez al año.',
    customerMessage: '¡Feliz cumpleaños! Este es tu regalo de parte de Rapidix.',
    discountType: TipoDescuento.FIXED,
    discountValue: 100,
    minimumOrderAmount: 0,
    maximumOrderAmount: null,
    validityDays: 15,
    usageLimitPerCustomer: 1,
    inactivityDays: null,
    birthdayWindowDays: 3,
  },
];

const FUENTES = [
  { name: 'Ana Influencer', type: TipoFuente.INFLUENCER, code: 'ANA01' },
  { name: 'Facebook Septiembre', type: TipoFuente.FACEBOOK, code: 'FBSEP01' },
  { name: 'QR Restaurante Centro', type: TipoFuente.QR, code: 'QRCENTRO01' },
];

// ------------------------------------------------------------------
// Contenido (mockup: promos, avisos)
// ------------------------------------------------------------------

const NOTICIAS = [
  { badge: '2x1', titulo: 'Pechuga de pollo al 2x1', desc: 'Válido de lunes a jueves en toda la tienda Rapidix.' },
  { badge: 'Envío gratis', titulo: 'Envío gratis en compras +$300', desc: 'Aplica automáticamente al finalizar tu pedido.' },
  { badge: 'Cashback', titulo: '10% de cashback en tu primer pedido', desc: 'El saldo se refleja al instante en tu perfil.' },
];

const AVISOS = [
  { icon: '🕘', titulo: 'Nuevo horario de entrega', desc: 'Ahora recibimos pedidos de 8:00 am a 9:00 pm todos los días.' },
  { icon: '📖', titulo: 'Recetario actualizado', desc: 'Se agregaron nuevas recetas compartidas por la comunidad Rapidix.' },
  { icon: '🚚', titulo: 'Nueva zona de cobertura', desc: 'Ahora entregamos también en la zona norte de Tuxtla Gutiérrez.' },
];

/**
 * Tabla de niveles del negocio (HU-17): umbral de gasto y % de cashback.
 * Ni el Word ni el mockup la definen. Editables desde Administracion.
 */
const NIVELES = [
  { nombre: 'Bronce', umbralGasto: 0, orden: 1, porcentaje: 1 },
  { nombre: 'Plata', umbralGasto: 30000, orden: 2, porcentaje: 1.5 },
  { nombre: 'Oro', umbralGasto: 60000, orden: 3, porcentaje: 2 },
  { nombre: 'Platino', umbralGasto: 90000, orden: 4, porcentaje: 2.5 },
];

// ------------------------------------------------------------------

/**
 * Usuario administrador inicial. Sin el, nadie puede entrar al panel.
 *
 * Las credenciales salen de ADMIN_EMAIL / ADMIN_PASSWORD. Si no estan
 * definidas se usan las de desarrollo, y el script avisa en pantalla.
 */
async function seedAdministrador(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@rapidix.mx').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'rapidix-admin-2026';
  const usaValoresPorDefecto = !process.env.ADMIN_PASSWORD;

  if (usaValoresPorDefecto && process.env.NODE_ENV === 'production') {
    throw new Error(
      'Define ADMIN_PASSWORD antes de sembrar en produccion: no se crea un admin con la contrasena por defecto.',
    );
  }

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    console.log(`  usuarios: ${email} ya existe, no se toca su contrasena`);
    return;
  }

  await prisma.usuario.create({
    data: {
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      nombre: 'Administrador',
      rol: RolUsuario.ADMINISTRADOR,
    },
  });

  console.log(`  usuarios: administrador creado (${email})`);
  if (usaValoresPorDefecto) {
    console.log(`    ATENCION: contrasena por defecto "${password}". Cambiala antes de publicar.`);
  }
}

async function seedConfiguracion(): Promise<void> {
  await prisma.configuracionNegocio.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      diasServicio: { lun: true, mar: true, mie: true, jue: true, vie: true, sab: true, dom: false },
      abre: '08:00',
      cierra: '18:00',
      atenderFuera: true,
      incrementoFuera: 20,
      whatsappAyuda: null,
      // Parametros vigentes del negocio (HU-16). El multiplicador es el x2 de
      // la billetera, no un porcentaje.
      costoEnvio: 30,
      montoEnvioGratis: 599.99,
      multiplicadorCashback: 2,
      montoMinimoCashback: 600,
      banco: null,
      beneficiario: null,
      numeroCuenta: null,
    },
  });
  console.log('  configuracion_negocio: fila 1 lista');
}

async function seedNiveles(): Promise<void> {
  for (const nivel of NIVELES) {
    await prisma.nivelFidelidad.upsert({
      where: { nombre: nivel.nombre },
      update: { umbralGasto: nivel.umbralGasto, orden: nivel.orden, porcentaje: nivel.porcentaje },
      create: nivel,
    });
  }
  console.log(`  niveles_fidelidad: ${NIVELES.length} niveles`);
}

async function seedTiposCicloVida(): Promise<void> {
  for (const tipo of TIPOS_CICLO_VIDA) {
    await prisma.tipoCuponCicloVida.upsert({
      where: { code: tipo.code },
      update: {},
      create: tipo,
    });
  }
  console.log(`  cupones_ciclo_vida: ${TIPOS_CICLO_VIDA.length} tipos fijos`);
}

async function seedFuentes(): Promise<void> {
  for (const fuente of FUENTES) {
    await prisma.fuenteAdquisicion.upsert({
      where: { code: fuente.code },
      update: {},
      create: fuente,
    });
  }
  console.log(`  fuentes_adquisicion: ${FUENTES.length} fuentes`);
}

async function seedProductos(): Promise<void> {
  const existentes = await prisma.producto.count();
  if (existentes > 0) {
    console.log(`  productos: ${existentes} ya existen, se omite`);
    return;
  }

  // El catalogo de categorias se llena con las que traen los productos, igual
  // que hace la importacion de Excel.
  const nombres = [...new Set(PRODUCTOS.map((p) => p.categoria))];
  const categorias = new Map<string, string>();
  for (const nombre of nombres) {
    const prioridad = PRIORIDAD_FAMILIA[nombre] ?? 99;
    const categoria = await prisma.categoria.upsert({
      where: { nombre },
      update: { prioridad },
      create: { nombre, prioridad },
      select: { id: true },
    });
    categorias.set(nombre, categoria.id);
  }
  console.log(`  categorias: ${nombres.length} en el catalogo`);

  await prisma.producto.createMany({
    data: PRODUCTOS.map(({ categoria, ...resto }) => ({
      ...resto,
      categoriaId: categorias.get(categoria) as string,
    })),
  });
  console.log(`  productos: ${PRODUCTOS.length} creados`);
}

async function seedRecetas(): Promise<void> {
  const existentes = await prisma.receta.count();
  if (existentes > 0) {
    console.log(`  recetas: ${existentes} ya existen, se omite`);
    return;
  }
  for (const receta of RECETAS) {
    await prisma.receta.create({
      data: {
        nombre: receta.nombre,
        tiempo: receta.tiempo,
        porciones: receta.porciones,
        youtube: receta.youtube,
        categorias: receta.categorias,
        autorNombre: receta.autorNombre,
        autorClienteId: null,
        origin: receta.origin,
        compartir: receta.compartir,
        emoji: receta.emoji,
        ingredientes: {
          create: receta.ingredientes.map((ing, i) => ({ ...ing, orden: i + 1 })),
        },
        pasos: {
          create: receta.pasos.map((texto, i) => ({ texto, orden: i + 1 })),
        },
      },
    });
  }
  const oficiales = RECETAS.filter((r) => r.origin === OrigenReceta.RECETARIO).length;
  const comunidad = RECETAS.length - oficiales;
  console.log(`  recetas: ${oficiales} oficiales + ${comunidad} de comunidad`);
}

async function seedContenido(): Promise<void> {
  if ((await prisma.noticiaDestacada.count()) === 0) {
    await prisma.noticiaDestacada.createMany({ data: NOTICIAS });
    console.log(`  noticias_destacadas: ${NOTICIAS.length} creadas`);
  } else {
    console.log('  noticias_destacadas: ya existen, se omite');
  }

  if ((await prisma.aviso.count()) === 0) {
    await prisma.aviso.createMany({ data: AVISOS });
    console.log(`  avisos: ${AVISOS.length} creados`);
  } else {
    console.log('  avisos: ya existen, se omite');
  }
}

async function main(): Promise<void> {
  console.log('Sembrando datos de Rapidix...');
  await seedAdministrador();
  await seedConfiguracion();
  await seedNiveles();
  await seedTiposCicloVida();
  await seedFuentes();
  await seedProductos();
  await seedRecetas();
  await seedContenido();
  console.log('Listo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
