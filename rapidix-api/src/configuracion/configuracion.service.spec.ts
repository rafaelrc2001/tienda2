import { ConfiguracionNegocio } from '@prisma/client';
import { ConfiguracionService } from './configuracion.service';

const TODOS_LOS_DIAS = { dom: true, lun: true, mar: true, mie: true, jue: true, vie: true, sab: true };

const config = (extra: Partial<ConfiguracionNegocio> = {}): ConfiguracionNegocio =>
  ({ diasServicio: TODOS_LOS_DIAS, abre: '08:00', cierra: '18:00', ...extra }) as ConfiguracionNegocio;

const MEXICO = 'America/Mexico_City';

describe('ConfiguracionService.estaDentroDeHorario', () => {
  it('lee la hora en la zona del negocio, no en la del servidor (UTC en Railway)', () => {
    // 22:07 UTC = 16:07 en Mexico: abierto.
    expect(
      ConfiguracionService.estaDentroDeHorario(config(), new Date('2026-09-14T22:07:00Z'), MEXICO),
    ).toBe(true);
  });

  it('cierra a la hora local', () => {
    // 00:30 UTC del martes = 18:30 del lunes en Mexico.
    expect(
      ConfiguracionService.estaDentroDeHorario(config(), new Date('2026-09-15T00:30:00Z'), MEXICO),
    ).toBe(false);
  });

  it('toma el dia local: de noche en Mexico en UTC ya es el dia siguiente', () => {
    // Lunes 22:00 en Mexico es martes 04:00 UTC. Solo abre el lunes.
    const soloLunes = config({
      diasServicio: { ...TODOS_LOS_DIAS, mar: false },
      abre: '20:00',
      cierra: '23:00',
    });
    expect(
      ConfiguracionService.estaDentroDeHorario(soloLunes, new Date('2026-09-15T04:00:00Z'), MEXICO),
    ).toBe(true);
  });

  it('un horario que cruza la medianoche sigue abierto de madrugada', () => {
    const nocturno = config({ abre: '22:00', cierra: '02:00' });
    // 07:30 UTC = 01:30 en Mexico.
    expect(
      ConfiguracionService.estaDentroDeHorario(nocturno, new Date('2026-09-15T07:30:00Z'), MEXICO),
    ).toBe(true);
  });
});
