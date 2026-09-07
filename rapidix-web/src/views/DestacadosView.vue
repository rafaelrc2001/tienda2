<script setup lang="ts">
/**
 * Destacados: noticias y avisos (Word 4.6).
 *
 * Al entrar se llama a `POST /destacados/leido`, que apaga la insignia de la
 * barra inferior. El contador no es global: la API lo calcula comparando la
 * fecha de publicación con la última lectura de cada cliente.
 */
import { onMounted } from 'vue'
import { useDestacadosStore } from '@/stores/destacados'
import { useUiStore } from '@/stores/ui'
import { fecha } from '@/utils/formato'
import SkeletonList from '@/components/SkeletonList.vue'

const destacados = useDestacadosStore()
const ui = useUiStore()

onMounted(async () => {
  try {
    if (destacados.datos === null) await destacados.cargar()
    await destacados.marcarLeido()
  } catch (fallo) {
    ui.errorDeApi(fallo)
  }
})
</script>

<template>
  <div class="destacados">
    <SkeletonList v-if="destacados.cargando && destacados.datos === null" :cantidad="3" />

    <template v-else>
      <template v-if="destacados.noticias.length > 0">
        <h2 class="section-title"><span class="accent-bar" />Noticias</h2>
        <article v-for="noticia in destacados.noticias" :key="noticia.id" class="tarjeta noticia">
          <span class="badge">{{ noticia.badge }}</span>
          <p class="titulo">{{ noticia.titulo }}</p>
          <p class="desc">{{ noticia.desc }}</p>
          <p class="fecha">{{ fecha(noticia.publicadoEn) }}</p>
        </article>
      </template>

      <template v-if="destacados.avisos.length > 0">
        <h2 class="section-title"><span class="accent-bar" />Avisos</h2>
        <article v-for="aviso in destacados.avisos" :key="aviso.id" class="tarjeta aviso">
          <div class="aviso-cabecera">
            <span class="ico">{{ aviso.icon }}</span>
            <p class="titulo">{{ aviso.titulo }}</p>
          </div>
          <p class="desc">{{ aviso.desc }}</p>
          <p class="fecha">{{ fecha(aviso.publicadoEn) }}</p>
        </article>
      </template>

      <p
        v-if="destacados.noticias.length === 0 && destacados.avisos.length === 0"
        class="empty-block"
      >
        No hay noticias ni avisos por ahora.
      </p>
    </template>
  </div>
</template>

<style scoped>
.destacados {
  padding: 0 0 12px;
}

.tarjeta {
  margin: 0 18px 14px;
  border-radius: 16px;
  padding: 14px;
  box-shadow: var(--shadow);
}

.noticia {
  background: var(--navy);
  color: var(--white);
}

.aviso {
  background: var(--white);
  border-left: 4px solid var(--gold-dark);
}

.badge {
  display: inline-block;
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 700;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.aviso-cabecera {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.aviso-cabecera .ico {
  font-size: 22px;
  flex-shrink: 0;
}

.titulo {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 14px;
  margin: 0;
  line-height: 1.3;
}

.aviso .titulo {
  color: var(--ink);
}

.desc {
  font-size: 12.5px;
  line-height: 1.5;
  margin: 6px 0 0;
}

.noticia .desc {
  color: #d7dfeb;
}

.aviso .desc {
  color: var(--muted);
}

.fecha {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 10.5px;
  margin: 10px 0 0;
  opacity: 0.75;
}

.aviso .fecha {
  color: var(--muted);
}
</style>
