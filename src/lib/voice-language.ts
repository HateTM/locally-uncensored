/**
 * Which Piper voice reads a reply (FINDINGS 16).
 *
 * A Piper voice speaks one language. An English voice given Russian text
 * spells the Cyrillic out letter by letter, so a reply written mostly in
 * Cyrillic goes to the Cyrillic voice when the user picked one. Only the
 * script is checked: telling Russian from Ukrainian or English from German by
 * the letters alone would be a guess, and a wrong guess is worse than the
 * voice the user chose.
 */
export function isMostlyCyrillic(text: string): boolean {
  let cyrillic = 0
  let letters = 0
  for (const ch of text) {
    if (/\p{L}/u.test(ch)) {
      letters++
      if (/\p{Script=Cyrillic}/u.test(ch)) cyrillic++
    }
  }
  return letters > 0 && cyrillic / letters > 0.5
}

export function piperVoiceFor(text: string, mainVoice: string, cyrillicVoice: string): string {
  return cyrillicVoice && isMostlyCyrillic(text) ? cyrillicVoice : mainVoice
}
