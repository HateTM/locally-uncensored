/**
 * Stimme auf Russisch und eine waehlbare Whisper-Groesse (FINDINGS 16).
 *
 * Piper bot nur englische Stimmen an; eine englische Stimme buchstabiert
 * kyrillischen Text. Eine Antwort, die ueberwiegend kyrillisch ist, geht jetzt
 * an die Stimme fuer russische Antworten, wenn eine gewaehlt ist. Whisper lief
 * fest auf "base", der schwaechsten brauchbaren Groesse; die gewaehlte Groesse
 * geht jetzt mit jeder Aufnahme an den Server (Tauri und Browser).
 *
 * Run: npx vitest run src/api/__tests__/voice-russisch-und-whisper-groesse.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { isMostlyCyrillic, piperVoiceFor } from '../../lib/voice-language'
import { transcribeAudio } from '../voice'
import { useVoiceStore, WHISPER_MODEL_SIZES } from '../../stores/voiceStore'

describe('Stimme nach Schrift', () => {
  it('eine ueberwiegend kyrillische Antwort geht an die russische Stimme', () => {
    expect(isMostlyCyrillic('Привет! Это ответ на русском, с API и Docker.')).toBe(true)
    expect(isMostlyCyrillic('Use the Docker API, see "Привет" in the log.')).toBe(false)
    expect(isMostlyCyrillic('12345 !!!')).toBe(false)
    expect(piperVoiceFor('Привет, мир', 'en_US-lessac-medium', 'ru_RU-irina-medium')).toBe('ru_RU-irina-medium')
    expect(piperVoiceFor('Hello world', 'en_US-lessac-medium', 'ru_RU-irina-medium')).toBe('en_US-lessac-medium')
  })

  it('ohne gewaehlte russische Stimme bleibt es bei der Hauptstimme', () => {
    expect(piperVoiceFor('Привет, мир', 'en_US-lessac-medium', '')).toBe('en_US-lessac-medium')
    expect(useVoiceStore.getState().piperVoiceCyrillic).toBe('')
  })
})

describe('Whisper-Groesse', () => {
  afterEach(() => vi.restoreAllMocks())

  it('der Browser-Weg schickt die gewaehlte Groesse mit', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ transcript: 'привет' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await expect(transcribeAudio(new Blob([new Uint8Array([1])], { type: 'audio/wav' }), 'small')).resolves.toBe('привет')
    expect(String(spy.mock.calls[0][0])).toBe('/local-api/transcribe?model=small')
  })

  it('App, Server-Skript und Rust bieten dieselben Groessen an, Standard bleibt base', () => {
    expect(useVoiceStore.getState().whisperModel).toBe('base')
    const py = readFileSync('src-tauri/resources/whisper_server.py', 'utf8')
    const rs = readFileSync('src-tauri/src/commands/whisper.rs', 'utf8')
    const quoted = WHISPER_MODEL_SIZES.map((m) => `"${m}"`).join(', ')
    expect(py).toContain(`MODELS = (${quoted})`)
    expect(rs).toContain(`WHISPER_MODELS: &[&str] = &[${quoted}]`)
  })
})
