import { Controller, Get } from '@nestjs/common';
import { UsuarioActual } from '../auth/usuario-actual.decorator';
import { UsuarioAutenticado } from '../auth/jwt-payload';
import { PERMISOS_POR_ROL, Seccion } from '../auth/permisos';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

interface ItemMenu {
  seccion: Seccion;
  icono: string;
  titulo: string;
  descripcion: string;
}

/** Textos e iconos de `adminMenuItemsCatalog` del prototipo. */
const CATALOGO: Readonly<Record<Seccion, Omit<ItemMenu, 'seccion'>>> = {
  productos: {
    icono: '📦',
    titulo: 'Productos',
    descripcion: 'Agregar manualmente o cargar por Excel',
  },
  recetas: { icono: '🍳', titulo: 'Recetas', descripcion: 'Dar de alta recetas del Recetario' },
  configuracion: {
    icono: '⚙️',
    titulo: 'Configuración',
    descripcion: 'Horario, parámetros, datos bancarios y más',
  },
  operaciones: {
    icono: '🧭',
    titulo: 'Operaciones',
    descripcion: 'Seguimiento del día a día del negocio',
  },
  rutas: { icono: '🛵', titulo: 'Rutas', descripcion: 'Asignación de rutas de reparto' },
  finanzas: { icono: '💵', titulo: 'Finanzas', descripcion: 'Ingresos, gastos y desempeño' },
  'mis-pedidos': { icono: '🧾', titulo: 'Mis Pedidos', descripcion: 'Historial de pedidos' },
  'mis-cupones': { icono: '🎁', titulo: 'Mis Cupones', descripcion: 'Cupones disponibles para ti' },
  clientes: { icono: '👥', titulo: 'Clientes', descripcion: 'Base de clientes y su actividad' },
};

@ApiTags('Administración')
@ApiBearerAuth()
@Controller('admin')
export class AdminMenuController {
  /**
   * Menu del panel para el rol del token. El frontend no decide que mostrar:
   * lo pregunta, y asi no puede quedar desalineado con lo que la API permite.
   */
  @Get('menu')
  menu(@UsuarioActual() usuario: UsuarioAutenticado): ItemMenu[] {
    return PERMISOS_POR_ROL[usuario.rol].map((seccion) => ({
      seccion,
      ...CATALOGO[seccion],
    }));
  }
}
