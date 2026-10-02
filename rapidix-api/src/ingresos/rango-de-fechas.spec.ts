import { BadRequestException } from '@nestjs/common';
import { diaEn, diaSiguiente, inicioDelDia, rangoDeFechas } from './rango-de-fechas';

const MEXICO = 'America/Mexico_City';

describe('diaEn', () => {
  it('a las 19:00 de México todavía es hoy, aunque en UTC ya sea mañana', () => {
    // 2026-10-02T01:00Z son las 19:00 del día 1 en México (UTC-6).
    expect(diaEn(new Date('2026-10-02T01:00:00Z'), MEXICO)).toBe('2026-10-01');
  });

  it('pasada la medianoche local ya es el día siguiente', () => {
    expect(diaEn(new Date('2026-10-02T06:00:00Z'), MEXICO)).toBe('2026-10-02');
  });
});

describe('inicioDelDia', () => {
  it('la medianoche de México son las 06:00 UTC', () => {
    expect(inicioDelDia('2026-10-01', MEXICO).toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });

  it('en UTC la medianoche es la medianoche', () => {
    expect(inicioDelDia('2026-10-01', 'UTC').toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('respeta el horario de verano de una zona que lo tiene', () => {
    // Nueva York: UTC-4 en verano, UTC-5 en invierno.
    expect(inicioDelDia('2026-07-01', 'America/New_York').toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
    expect(inicioDelDia('2026-12-01', 'America/New_York').toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
  });

  it('el día del cambio de horario empieza con el desfase de antes del cambio', () => {
    // El 8 de marzo de 2026 Nueva York adelanta el reloj a las 02:00: su
    // medianoche todavía es UTC-5.
    expect(inicioDelDia('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(inicioDelDia('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });
});

describe('diaSiguiente', () => {
  it('cruza el mes y el año', () => {
    expect(diaSiguiente('2026-10-31')).toBe('2026-11-01');
    expect(diaSiguiente('2026-12-31')).toBe('2027-01-01');
  });
});

describe('rangoDeFechas', () => {
  const ahora = new Date('2026-10-02T01:00:00Z'); // 1 de octubre, 19:00 en México

  it('sin fechas es hoy, en el día del negocio', () => {
    const rango = rangoDeFechas(undefined, undefined, ahora, MEXICO);
    expect(rango).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-01' });
    expect(rango.inicio.toISOString()).toBe('2026-10-01T06:00:00.000Z');
    expect(rango.fin.toISOString()).toBe('2026-10-02T06:00:00.000Z');
  });

  it('con una sola fecha es ese día entero', () => {
    expect(rangoDeFechas('2026-09-15', undefined, ahora, MEXICO)).toMatchObject({
      desde: '2026-09-15',
      hasta: '2026-09-15',
    });
    expect(rangoDeFechas(undefined, '2026-09-15', ahora, MEXICO)).toMatchObject({
      desde: '2026-09-15',
      hasta: '2026-09-15',
    });
  });

  it('con las dos incluye el último día completo', () => {
    const rango = rangoDeFechas('2026-09-01', '2026-09-30', ahora, MEXICO);
    expect(rango.inicio.toISOString()).toBe('2026-09-01T06:00:00.000Z');
    expect(rango.fin.toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });

  it('rechaza un rango al revés', () => {
    expect(() => rangoDeFechas('2026-09-30', '2026-09-01', ahora, MEXICO)).toThrow(
      BadRequestException,
    );
  });

  it('rechaza lo que no es un día que exista', () => {
    expect(() => rangoDeFechas('2026-02-30', undefined, ahora, MEXICO)).toThrow(
      BadRequestException,
    );
    expect(() => rangoDeFechas('ayer', undefined, ahora, MEXICO)).toThrow(BadRequestException);
  });
});
