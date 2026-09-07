import { describe, expect, it } from 'vitest'
import { ErrorApi } from './http'

/**
 * El traductor de errores de la API.
 *
 * Nest devuelve `message` de dos formas distintas y la interfaz tiene que
 * distinguir un error de validación de uno de negocio: uno se pinta bajo su
 * campo y el otro como toast.
 */
describe('ErrorApi', () => {
  it('expone el mensaje, el estado y el código de negocio', () => {
    const error = new ErrorApi(400, 'Dinos tu nombre', 'NOMBRE_REQUERIDO')

    expect(error.message).toBe('Dinos tu nombre')
    expect(error.estado).toBe(400)
    expect(error.codigo).toBe('NOMBRE_REQUERIDO')
    expect(error.mensajes).toEqual([])
  })

  it('es un Error de verdad, para poder capturarlo con instanceof', () => {
    const error = new ErrorApi(500, 'Fallo')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ErrorApi)
    expect(error.name).toBe('ErrorApi')
  })

  it('deja el código a null cuando el error no trae uno', () => {
    expect(new ErrorApi(404, 'No encontrado').codigo).toBeNull()
  })

  describe('cuponDeBloqueo', () => {
    it('extrae el cupón INACTIVITY que viaja dentro del 423', () => {
      const error = new ErrorApi(423, 'Recetario bloqueado', 'RECETARIO_BLOQUEADO', [], {
        cupon: {
          code: 'INAC123',
          titulo: 'Te echamos de menos',
          mensaje: 'Vuelve con 15% de descuento',
          expiresAt: '2026-10-01T00:00:00.000Z',
        },
      })

      expect(error.cuponDeBloqueo?.code).toBe('INAC123')
      expect(error.cuponDeBloqueo?.titulo).toBe('Te echamos de menos')
    })

    it('devuelve null cuando el bloqueo no trae cupón', () => {
      expect(new ErrorApi(423, 'Bloqueado', 'RECETARIO_BLOQUEADO', [], {}).cuponDeBloqueo).toBeNull()
      expect(new ErrorApi(400, 'Otro error').cuponDeBloqueo).toBeNull()
    })
  })

  describe('porCampo', () => {
    const CAMPOS = ['nombre', 'email', 'telefono'] as const

    /** Formato por defecto de Nest: "<propiedad> <restricción>". */
    it('reparte los mensajes del ValidationPipe bajo su campo', () => {
      const error = new ErrorApi(400, 'Error de validación', null, [
        'nombre must be a string',
        'email must be an email',
      ])

      const { campos, generales } = error.porCampo(CAMPOS)

      expect(campos.nombre).toBe('nombre must be a string')
      expect(campos.email).toBe('email must be an email')
      expect(generales).toEqual([])
    })

    /**
     * Los DTO de Rapidix definen `message` propio, así que muchos mensajes no
     * llevan el nombre del campo. Esos no se pueden atribuir y van arriba del
     * formulario, no se pierden.
     */
    it('manda a generales los mensajes que no empiezan por un campo', () => {
      const error = new ErrorApi(400, 'Error', null, [
        'El nombre es obligatorio',
        'nombre must be a string',
      ])

      const { campos, generales } = error.porCampo(CAMPOS)

      expect(campos.nombre).toBe('nombre must be a string')
      expect(generales).toEqual(['El nombre es obligatorio'])
    })

    it('se queda con el primer mensaje de cada campo', () => {
      const error = new ErrorApi(400, 'Error', null, [
        'nombre must be a string',
        'nombre must be longer than 2 characters',
      ])

      const { campos, generales } = error.porCampo(CAMPOS)

      expect(campos.nombre).toBe('nombre must be a string')
      expect(generales).toEqual(['nombre must be longer than 2 characters'])
    })

    /** Un campo que no está en el formulario no debe casar por prefijo. */
    it('no atribuye a un campo que no se le pasó', () => {
      const error = new ErrorApi(400, 'Error', null, ['telefono should not exist'])

      const { campos, generales } = error.porCampo(['nombre'])

      expect(campos).toEqual({})
      expect(generales).toEqual(['telefono should not exist'])
    })

    it('no devuelve nada para un error de negocio, que no trae lista', () => {
      const error = new ErrorApi(409, 'Ese cupón acaba de usarse en otro pedido.')

      const { campos, generales } = error.porCampo(CAMPOS)

      expect(campos).toEqual({})
      expect(generales).toEqual([])
    })
  })
})
