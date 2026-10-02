// @vitest-environment jsdom
/**
 * Der lokale Modellwaehler ordnet nach Stufe, wie der Cloud-Waehler.
 *
 * 02.10.2026, David: "Best" oben mit kleiner Marke, Aeltere gesammelt unten
 * unter "Older models", nichts wird versteckt, Reihenfolge innerhalb einer
 * Stufe bleibt wie die Liste sie liefert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../../../hooks/useContentPolicy', () => ({
  useContentPolicy: () => 'soft' as const,
  primeContentPolicyCache: vi.fn(),
}))

import { ModelChip } from '../ModelChip'
import { useCreateStore } from '../../../../stores/createStore'
import { OLDER_GROUP } from '../../../../lib/render/model-tier'
import { classifyModel, type ClassifiedModel } from '../../../../api/comfyui'

const model = (name: string): ClassifiedModel =>
  ({ name, type: classifyModel(name), folder: 'checkpoints' }) as unknown as ClassifiedModel

beforeEach(() => {
  cleanup()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** Hinter den lokalen Zeilen haengen die Cloud-Hinweiszeilen; nur die ersten n gehoeren zur Liste. */
function lies(n: number) {
  render(<ModelChip />)
  fireEvent.click(screen.getByRole('button'))
  const liste = document.querySelector('.lu-elevated') as HTMLElement
  if (!liste) throw new Error('Liste nicht offen')
  const zeilen = Array.from(liste.querySelectorAll('button')).map((b) => ({
    name: (b.querySelector('.truncate')?.textContent ?? '').trim(),
    best: Array.from(b.querySelectorAll('span')).some((s) => s.textContent === 'Best'),
    davor: b.previousElementSibling?.textContent ?? '',
  }))
  return zeilen.slice(0, n)
}

describe('lokaler Bildwaehler', () => {
  it('Beste oben mit Marke, Aeltere unten unter einer einzigen Zwischenzeile', () => {
    useCreateStore.setState({
      backend: 'local',
      imageModelList: [
        model('Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors'),
        model('chroma1-hd.safetensors'),
        model('qwen_image_2.1_int8_convrot.safetensors'),
        model('flux1-dev-fp8.safetensors'),
        model('z_image_turbo_bf16.safetensors'),
      ],
    })
    useCreateStore.getState().setIntent('image')
    const zeilen = lies(5)
    expect(zeilen).toHaveLength(5)
    expect(zeilen.slice(0, 2).every((z) => z.best)).toBe(true)
    expect(zeilen.slice(2).some((z) => z.best)).toBe(false)
    expect(zeilen.filter((z) => z.davor === OLDER_GROUP)).toHaveLength(1)
    expect(zeilen[3].davor).toBe(OLDER_GROUP)
    expect(zeilen[2].name).toMatch(/chroma/i)
  })

  it('der geschlossene Waehler zeigt keine Marke', () => {
    useCreateStore.setState({ backend: 'local', imageModelList: [model('z_image_turbo_bf16.safetensors')] })
    useCreateStore.getState().setIntent('image')
    render(<ModelChip />)
    expect(screen.queryByText('Best')).toBeNull()
    expect(screen.queryByText(OLDER_GROUP)).toBeNull()
  })
})

describe('lokaler Videowaehler', () => {
  it('LTX 2.5 und MiniMax H3 oben, LTX 2.3 und Wan 2.1 unten', () => {
    useCreateStore.setState({
      backend: 'local',
      videoModelList: [
        model('ltx-2.3-22b-distilled-fp8.safetensors'),
        model('wan2.2_ti2v_5B_fp16.safetensors'),
        model('ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors'),
        model('wan2.1_t2v_14B_fp8_e4m3fn.safetensors'),
      ],
    })
    useCreateStore.getState().setIntent('video')
    const zeilen = lies(4)
    expect(zeilen[0].best).toBe(true)
    expect(zeilen[0].name).toMatch(/2\.5/)
    expect(zeilen[2].davor).toBe(OLDER_GROUP)
    expect(zeilen.filter((z) => z.davor === OLDER_GROUP)).toHaveLength(1)
    expect(zeilen).toHaveLength(4)
  })
})
