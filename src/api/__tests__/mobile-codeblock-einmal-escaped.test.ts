/**
 * Ein Codeblock im Mobile-Client wird genau einmal escaped (FINDINGS 20).
 *
 * `renderMd` escapte frueher den ganzen Text und schnitt die Codebloecke dann
 * aus dem ESCAPTEN Text, um sie noch einmal zu escapen. Am 29.09.2026 mit der
 * echten Funktion gemessen: `<div class="a">` erschien als
 * `&amp;lt;div …&amp;gt;`, also als `&lt;div …&gt;` auf dem Bildschirm, und
 * Copy wie Preview bekamen die Entities statt des Codes. Dazu liefen die
 * Inline-Regeln (`code`, **fett**) ueber das fertige Block-HTML.
 *
 * Laeuft auf den ausgelieferten Bytes von mobile-client/client.js
 * (mobile-client-shell.ts).
 *
 * Run: npx vitest run src/api/__tests__/mobile-codeblock-einmal-escaped.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { clientSource, loadFromClient } from './mobile-client-shell'

type Render = { renderMd: (t: string) => string }

// H() is a one-liner, which the shell's closing-brace cut cannot take; it is
// read from the same file, so this is still the shipped escaping.
const hLine = clientSource().split('\n').find((l) => l.startsWith('  function H(t)'))
if (!hLine) throw new Error('mobile-client/client.js no longer declares H(t) on one line')
const H = new Function(`${hLine}\nreturn H;`)() as (t: unknown) => string

let codeBlockSource: Record<string, { lang: string; code: string }>
let render: Render['renderMd']

beforeEach(() => {
  codeBlockSource = {}
  render = loadFromClient<Render>(['djb2', 'isHtmlSnippet', 'renderInline', 'codeBlockHtml', 'renderMd'], {
    H,
    codeBlockSource,
    codeBlockOpen: {},
    COLLAPSE_THRESHOLD: 4,
    svgIcon: () => '',
  }).renderMd
})

describe('ein Codeblock im Mobile-Client', () => {
  it('zeigt HTML als Text, einmal escaped', () => {
    const html = render('Here:\n```html\n<div class="a">x & y</div>\n```')
    const shown = /<code>([\s\S]*?)<\/code>/.exec(html)?.[1]
    expect(shown).toBe('&lt;div class="a"&gt;x &amp; y&lt;/div&gt;')
  })

  it('gibt Copy und Preview den Code selbst, nicht die Entities', () => {
    render('```html\n<div class="a">x & y</div>\n```')
    const [entry] = Object.values(codeBlockSource)
    expect(entry).toEqual({ lang: 'html', code: '<div class="a">x & y</div>' })
  })

  it('bietet Preview fuer ein HTML-Snippet an', () => {
    expect(render('```html\n<div>hi</div>\n```')).toContain('Preview HTML')
  })

  it('laesst ** und `…` im Code stehen, formatiert sie aber im Fliesstext', () => {
    const html = render('Use **bold** and `tick`.\n```js\nconst a = 2 ** 3 // `x`\n```')
    const code = /<pre class="cb-pre"><code>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1]
    expect(code).toBe('const a = 2 ** 3 // `x`')
    expect(html).toContain('<b>bold</b>')
    expect(html).toContain('<code>tick</code>')
  })

  it('escaped Fliesstext weiterhin, damit Modelltext kein HTML wird', () => {
    const html = render('<img src=x onerror=alert(1)> and **<b>x</b>**')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('rendert mehrere Bloecke und den Text dazwischen in der richtigen Reihenfolge', () => {
    const html = render('PROSA1\n```\nCODE1\n```\nPROSA2\n```\nCODE2\n```\nPROSA3')
    const order = ['PROSA1', 'CODE1', 'PROSA2', 'CODE2', 'PROSA3'].map((t) => html.indexOf(t))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((x, y) => x - y))
  })
})
