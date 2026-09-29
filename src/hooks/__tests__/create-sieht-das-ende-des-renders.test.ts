/**
 * Create beendet einen Render auf dem Frame, den ComfyUI wirklich schickt.
 *
 * Gemessen am 29.09.2026 gegen ComfyUI 0.37 (`a716932`): am Ende eines Prompts
 * schickt execution.py `execution_success` (oder `execution_interrupted`), und
 * main.py danach `executing` mit `node: null`. Ein Frame `execution_complete`
 * existiert dort nicht. Genau auf den hat Create gewartet; `executing` mit
 * `null` wurde erkannt und mit `break` verworfen. Jeder Render kam deshalb erst
 * mit dem 10-s-Herzschlag, der `/history` abfragt: 0 bis 10 s zu spaet, und im
 * Log stand jedes Mal "WS event missed" (FINDINGS 21).
 *
 * Die Pruefung liest die Quelle, wie der Rest dieser Suite (der Hook laesst
 * sich ohne ComfyUI, WebSocket und Tauri nicht sinnvoll montieren).
 *
 * Run: npx vitest run src/hooks/__tests__/create-sieht-das-ende-des-renders.test.ts
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const src = fs.readFileSync(path.join(__dirname, '..', 'useCreate.ts'), 'utf8')
const listener = src.slice(src.indexOf('const removeListener = comfyWS.on('), src.indexOf('}, wsMark)'))
/** The text of one `case` of the listener's switch, up to the next `case`. */
const caseBody = (name: string) => {
  const at = listener.indexOf(`case '${name}':`)
  if (at < 0) return ''
  const next = listener.indexOf('case \'', at + 6)
  return listener.slice(at, next < 0 ? undefined : next)
}

describe('Create sieht das Ende eines Renders sofort', () => {
  it('execution_success beendet den Render ueber denselben Weg wie jeder andere Endframe', () => {
    expect(caseBody('execution_success')).not.toBe('')
    // execution_success faellt in den Zweig, der finishFromHistory ruft.
    const combined = listener.slice(listener.indexOf("case 'execution_success':"))
    expect(combined.slice(0, combined.indexOf('break'))).toContain('finishFromHistory()')
  })

  it('executing mit node null beendet ihn ebenfalls, statt verworfen zu werden', () => {
    const executing = listener.slice(listener.indexOf("case 'executing':"), listener.indexOf("case 'progress':"))
    const nullBranch = executing.slice(executing.indexOf('if (nodeId === null)'))
    expect(nullBranch.slice(0, nullBranch.indexOf('}'))).toContain('finishFromHistory()')
  })

  it('der Abschluss laeuft genau einmal, egal wie viele Endframes kommen', () => {
    const fn = src.slice(src.indexOf('const finishFromHistory = () => {'))
    expect(fn.slice(0, 200)).toMatch(/if \(completionHandled\) return\s+completionHandled = true/)
  })

  it('ein in ComfyUI abgebrochener Render meldet sich, statt auf den Timeout zu warten', () => {
    const interrupted = caseBody('execution_interrupted')
    expect(interrupted).toContain('cleanup()')
    expect(interrupted).toContain('reject(')
  })

  it('der Herzschlag bleibt das Netz darunter', () => {
    expect(src).toContain("console.log('[useCreate] Completion detected via polling (WS event missed)')")
  })
})
