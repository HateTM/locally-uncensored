// @vitest-environment jsdom
/**
 * Customer report 02.10.2026: with Qwen Image Edit ("no mask needed") the Edit
 * stage still said "Paint a mask". An instruction editor takes no mask, so the
 * stage hides the Paint mask button and says so. A masked editor keeps both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), makeVoice: vi.fn(), connected: true, modelsLoaded: true,
    cloudAvailable: true, uploadImage: vi.fn(), installCapability: vi.fn(),
  }),
}))

import { Stage } from '../Stage'
import { useCreateStore } from '../../../../stores/createStore'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'
import { neuerServer } from '../../../../lib/render/__tests__/fixtures/test-catalogs'

const BILD = { filename: 'a.png', url: 'data:image/png;base64,AA', width: 8, height: 8 }

function stage(model: string) {
  useCreateStore.setState({ backend: 'cloud', cloudImageModel: model, source: BILD, mask: null, isGenerating: false, gallery: [] })
  useCreateStore.getState().setIntent('edit')
  render(<Stage displayed={undefined} onOpenMaskEditor={vi.fn()} onEditResult={vi.fn()} onAnimateResult={vi.fn()} onFullscreen={vi.fn()} />)
}

beforeEach(() => { useCloudCatalogStore.setState({ models: neuerServer() }) })
afterEach(() => cleanup())

describe('Edit stage and the mask', () => {
  it('hides Paint mask and says no mask is needed on an instruction editor', () => {
    stage('qwen-image-edit')
    expect(screen.queryByText('Paint mask')).toBeNull()
    expect(screen.getByText(/needs no mask/)).toBeTruthy()
  })

  it('keeps Paint mask on a masked editor', () => {
    stage('flux-dev')
    expect(screen.getByText('Paint mask')).toBeTruthy()
    expect(screen.queryByText(/needs no mask/)).toBeNull()
  })
})
