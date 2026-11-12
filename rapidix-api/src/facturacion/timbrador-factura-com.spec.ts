import { claveDeRegimen, cuentasFacturaComDesdeEntorno } from './timbrador-factura-com';

describe('claveDeRegimen', () => {
  it('traduce el texto con el que factura.com manda el regimen de la cuenta', () => {
    expect(claveDeRegimen('Régimen Simplificado de Confianza')).toBe('626');
    expect(claveDeRegimen('General de Ley Personas Morales')).toBe('601');
    // Tal cual lo manda factura.com para una cuenta de plataformas tecnologicas.
    expect(
      claveDeRegimen(
        'RÉGIMEN DE LAS ACTIVIDADES EMPRESARIALES CON INGRESOS A TRAVÉS DE PLATAFORMAS TECNOLÓGICAS',
      ),
    ).toBe('625');
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

describe('cuentasFacturaComDesdeEntorno', () => {
  const NOMBRES = ['API_KEY', 'SECRET_KEY', 'SERIE'].flatMap((c) =>
    ['', '_2', '_3', '2', '3'].map((n) => `FACTURACOM_${c}${n}`),
  );
  const antes = { ...process.env };
  afterEach(() => {
    for (const n of NOMBRES) delete process.env[n];
    Object.assign(process.env, antes);
  });
  const poner = (sufijo: string, valor: string) => {
    process.env[`FACTURACOM_API_KEY${sufijo}`] = `k${valor}`;
    process.env[`FACTURACOM_SECRET_KEY${sufijo}`] = `s${valor}`;
    process.env[`FACTURACOM_SERIE${sufijo}`] = valor;
  };

  beforeEach(() => {
    for (const n of NOMBRES) delete process.env[n];
  });

  it('sin principal no hay ninguna, aunque haya una _2', () => {
    poner('_2', '2');
    expect(cuentasFacturaComDesdeEntorno()).toEqual([]);
  });

  it('lee la principal y las que siguen con sufijo, en orden', () => {
    poner('', '1');
    poner('_2', '2');
    expect(cuentasFacturaComDesdeEntorno().map((c) => c.serie)).toEqual(['1', '2']);
  });

  it('acepta el sufijo sin guion bajo (FACTURACOM_API_KEY2)', () => {
    poner('', '1');
    poner('2', '2');
    expect(cuentasFacturaComDesdeEntorno().map((c) => c.serie)).toEqual(['1', '2']);
  });

  it('una cuenta incompleta corta la lista', () => {
    poner('', '1');
    poner('_2', '2');
    delete process.env.FACTURACOM_SERIE_2;
    poner('_3', '3');
    expect(cuentasFacturaComDesdeEntorno().map((c) => c.serie)).toEqual(['1']);
  });
});
