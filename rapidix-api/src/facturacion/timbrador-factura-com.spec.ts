import { claveDeRegimen } from './timbrador-factura-com';

describe('claveDeRegimen', () => {
  it('traduce el texto con el que factura.com manda el regimen de la cuenta', () => {
    expect(claveDeRegimen('Régimen Simplificado de Confianza')).toBe('626');
    expect(claveDeRegimen('General de Ley Personas Morales')).toBe('601');
  });

  it('no depende de acentos, mayusculas ni espacios', () => {
    expect(claveDeRegimen('  REGIMEN SIMPLIFICADO  DE CONFIANZA ')).toBe('626');
    expect(claveDeRegimen('personas fisicas con actividades empresariales y profesionales')).toBe(
      '612',
    );
  });

  it('acepta la clave tal cual o con su nombre detras', () => {
    expect(claveDeRegimen('626')).toBe('626');
    expect(claveDeRegimen('612 - Personas Físicas con Actividades Empresariales')).toBe('612');
  });

  it('lo que no reconoce queda en null: la retencion no se aplica a ciegas', () => {
    expect(claveDeRegimen('Otro regimen inventado')).toBeNull();
    expect(claveDeRegimen(null)).toBeNull();
  });
});
