import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import {
  BuscarClientesDto,
  PaginaClientesDto,
  PaginaProspectosDto,
} from './dto/perfil.dto';
import { RequiereSeccion } from '../auth/seccion.decorator';

/**
 * Administracion -> Clientes.
 *
 * Quien entra sale de PERMISOS_POR_ROL: ADMINISTRADOR y FINANZAS tienen
 * 'clientes'; RUTA y OPERACIONES reciben 403 del RolesGuard.
 */
@ApiTags('Administración · Clientes')
@ApiBearerAuth()
@Controller('admin/clientes')
@RequiereSeccion('clientes')
export class AdminClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  listar(@Query() filtros: BuscarClientesDto): Promise<PaginaClientesDto> {
    return this.clientes.listarParaAdmin(filtros);
  }

  /**
   * Los que se registraron y todavia no han comprado.
   *
   * No son clientes y por eso no salen en el listado de arriba: aqui estan
   * para poder ir a buscarlos. En cuanto uno hace su primer pedido cambia de
   * lista solo.
   */
  @Get('prospectos')
  prospectos(@Query() filtros: BuscarClientesDto): Promise<PaginaProspectosDto> {
    return this.clientes.listarProspectosParaAdmin(filtros);
  }
}
