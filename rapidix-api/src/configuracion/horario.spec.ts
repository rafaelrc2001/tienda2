import { HorarioSemanal, avisoFueraDeHorario, estaAbierto } from './horario';

const MEXICO = 'America/Mexico_City';

/** Entre semana de 9 a 18, el sabado solo de 9 a 14 y el domingo cerrado. */
const tienda: HorarioSemanal = {
  lun: { abre: '09:00', cierra: '18:00' },
  mar: { abre: '09:00', cierra: '18:00' },
  mie: { abre: '09:00', cierra: '18:00' },
  jue: { abre: '09:00', cierra: '18:00' },
  vie: { abre: '09:00', cierra: '18:00' },
  sab: { abre: '09:00', cierra: '14:00' },
  dom: null,
};

// Fechas en UTC; Mexico va 6 horas atras. El 2026-11-23 es lunes.
const lunes = (hora: string) => new Date(`2026-11-23T${hora}:00-06:00`);
const sabado = (hora: string) => new Date(`2026-11-28T${hora}:00-06:00`);

describe('estaAbierto', () => {
  it('dentro de las horas del dia', () => {
    expect(estaAbierto(tienda, lunes('10:00'), MEXICO)).toBe(true);
  });

  it('el sabado cierra antes', () => {
    expect(estaAbierto(tienda, sabado('13:59'), MEXICO)).toBe(true);
    expect(estaAbierto(tienda, sabado('15:00'), MEXICO)).toBe(false);
  });

  it('un dia que cruza la medianoche sigue abierto de madrugada del dia siguiente', () => {
    const nocturno: HorarioSemanal = { lun: { abre: '22:00', cierra: '02:00' } };
    expect(estaAbierto(nocturno, new Date('2026-11-24T01:30:00-06:00'), MEXICO)).toBe(true);
    expect(estaAbierto(nocturno, new Date('2026-11-24T03:00:00-06:00'), MEXICO)).toBe(false);
  });
});

describe('avisoFueraDeHorario', () => {
  it('abierto no avisa', () => {
    expect(avisoFueraDeHorario(tienda, 'Centro', lunes('10:00'), MEXICO)).toBeNull();
  });

  it('cerrado dice que queda para el dia siguiente habil', () => {
    expect(avisoFueraDeHorario(tienda, 'Centro', lunes('20:00'), MEXICO)).toBe(
      'Centro está fuera de horario: tu pedido quedará programado para el día siguiente hábil.',
    );
  });
});
