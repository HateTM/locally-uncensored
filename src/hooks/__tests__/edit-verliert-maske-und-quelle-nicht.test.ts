/**
 * Ein Edit verliert weder Maske noch Quellbild (FINDINGS 22).
 *
 * Drei Wege haben die gemalte Maske still verworfen, und mit ihr oft das Bild:
 *
 *   1. Ein Preset, das dem Modell (oder seinem ganzen Typ) zugewiesen ist.
 *      `injectParameters` kennt keine Maske, und ein Preset ohne LoadImage hat
 *      auch fuer das Quellbild keinen Platz. Das Bild wurde neu gemalt.
 *   2. Der Legacy-Rueckfall, wenn der dynamische Builder etwas anderes als
 *      WorkflowUnavailableError wirft: `buildTxt2ImgWorkflow` ist reines
 *      Text-zu-Bild, `denoise: 1.0`, ohne Quelle, ohne Maske.
 *   3. Cloud -> lokal: im Cloud-Backend traegt die Maske `filename: ''`
 *      (MaskEditor.apply), und `ref.filename ?? …` machte daraus "kein Bild".
 *
 * Die Pruefung liest die Quelle, wie der Rest dieser Suite.
 *
 * Run: npx vitest run src/hooks/__tests__/edit-verliert-maske-und-quelle-nicht.test.ts
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const src = fs.readFileSync(path.join(__dirname, '..', 'useCreate.ts'), 'utf8')

describe('ein Edit verliert Maske und Quelle nicht', () => {
  it('ein Preset ohne Platz fuer Maske oder Quelle wird fuer den Edit uebergangen', () => {
    const check = src.slice(src.indexOf('let customWf = localOp'), src.indexOf("console.log('[useCreate] Custom workflow check:'"))
    expect(check).toMatch(/isEdit && \(maskFilename \|\| !wfNodes\.includes\('LoadImage'\)\)/)
    expect(check.slice(check.indexOf('isEdit && (maskFilename'))).toContain('customWf = null')
  })

  it('ein Edit und ein Animate fallen nicht auf den Text-zu-Bild-Builder zurueck', () => {
    const fallback = src.slice(src.indexOf('} catch (dynErr) {'), src.indexOf("builderUsed = 'legacy'"))
    const guard = fallback.indexOf('if (isEdit ||')
    expect(guard).toBeGreaterThan(0)
    expect(fallback.slice(guard, guard + 200)).toContain('throw dynErr')
  })

  it('eine nur als data-URL gehaltene Quelle oder Maske wird hochgeladen, sobald ComfyUI laeuft', () => {
    const guard = src.indexOf('const guard = await ensureComfyForRender(')
    const staging = src.indexOf("const staged = await stageForLocal(source, 'source')")
    const maskStaging = src.indexOf("maskFilename = await stageForLocal(mask, 'mask')")
    const build = src.indexOf("setProgress(0, 'Preparing workflow...')")
    expect(guard).toBeGreaterThan(0)
    expect(staging).toBeGreaterThan(guard)
    expect(maskStaging).toBeGreaterThan(guard)
    expect(build).toBeGreaterThan(Math.max(staging, maskStaging))
  })

  it('die Eingangspruefungen zaehlen ein data-URL-Bild als vorhanden', () => {
    const guards = src.slice(src.indexOf("if (localOp === 'lipsync') {"), src.indexOf('const guard = await ensureComfyForRender('))
    expect(guards).not.toContain('!source?.filename')
    expect(guards).toContain('hasStageImage(source)')
  })
})
