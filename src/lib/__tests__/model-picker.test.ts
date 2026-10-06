/**
 * The Cloud model picker's logic: rows, chips, search, groups, keyboard.
 *
 * 05.10.2026, the new model picker for Chat, Agent and Code in Cloud mode.
 * The component draws; lib/model-picker decides, and this file holds it
 * against rows in the exact shape the model store keeps them after a listing
 * (lib/cloud-model-row), so nothing here is tested on a shape the app never
 * sees.
 *
 * Run: npx vitest run src/lib/__tests__/model-picker.test.ts
 */
import { describe, expect, it } from 'vitest'
import { cloudModelRow } from '../cloud-model-row'
import { assignFamilies, groupByFamily, modelFamily, OTHER_FAMILY } from '../model-family'
import {
  PICKER_FILTERS, filterCounts, filterRows, formatCreditRate, highlightParts, moveCursor, pickerGroups, pickerRows,
  searchTokens,
  type PickerFilter,
} from '../model-picker'
import { PICKER_FIXTURE, pickerFixtureModels } from './model-picker-fixture'
import type { AIModel } from '../../types/models'

const MODELS = pickerFixtureModels()
const ROWS = pickerRows(MODELS, true)
const only = (...f: PickerFilter[]) => new Set<PickerFilter>(f)
const byLabel = (label: string) => ROWS.find((r) => r.label === label)!
const labels = (rows: { label: string }[]) => rows.map((r) => r.label)

describe('rows', () => {
  it('carry the catalogue label, with the prefixed id as the name the store keeps', () => {
    expect(ROWS).toHaveLength(PICKER_FIXTURE.length)
    expect(byLabel('Qwen 3.6 27B').name).toBe('lu-cloud::Qwen/Qwen3.6-27B')
    expect(byLabel('Qwen 3.6 27B').model).toBe(MODELS.find((m) => m.name === 'lu-cloud::Qwen/Qwen3.6-27B'))
  })

  it('fall back to the id where the server gave no short name', () => {
    const [row] = pickerRows([cloudModelRow({ id: 'a/model', name: 'a/model', provider: 'lu-cloud', providerName: 'LU Cloud' })], null)
    expect(row.label).toBe('a/model')
  })

  it('print a context window only when the server stated one, never the budget fallback', () => {
    // `contextLength` always holds a number to budget with (a table value or a
    // guess from the name). The picker must not print that as a fact.
    const [guessed, stated] = pickerRows([
      cloudModelRow({ id: 'a/one', name: 'One', provider: 'lu-cloud', providerName: 'LU Cloud', contextLength: 8192 }),
      cloudModelRow({ id: 'a/two', name: 'Two', provider: 'lu-cloud', providerName: 'LU Cloud', contextLength: 40960, declaredContext: 40960 }),
    ], null)
    expect(guessed.context).toBeNull()
    expect(stated.context).toBe(40960)
  })

  it('show image and video models nowhere, the picker is for text', () => {
    const image = { name: 'flux.safetensors', model: 'flux', size: 1, format: '', architecture: '', type: 'image' } as unknown as AIModel
    expect(pickerRows([...MODELS.slice(0, 2), image], true)).toHaveLength(2)
  })

  it('read vision and thinking from what the server stated, not from the name', () => {
    expect(byLabel('Qwen 3.6 27B').vision).toBe(true)
    expect(byLabel('Qwen 3.6 27B').thinking).toBe('toggle')
    expect(byLabel('DeepSeek R2').thinking).toBe('always')
    expect(byLabel('Llama 3.1 8B Turbo').vision).toBe(false)
    expect(byLabel('Llama 3.1 8B Turbo').thinking).toBeNull()
    // A name that sounds like a vision model and a server that said nothing.
    const [row] = pickerRows([cloudModelRow({ id: 'x/llava-next', name: 'Llava', provider: 'lu-cloud', providerName: 'LU Cloud' })], null)
    expect(row.vision).toBe(false)
    expect(row.thinking).toBeNull()
  })

  it('carry the credit rates the server sent, and none where it sent none', () => {
    expect(byLabel('Qwen 3.6 27B').rates).toEqual({ inputPerMillion: 32000, outputPerMillion: 320000 })
    expect(byLabel('Kimi K3').rates).toBeNull()
  })

  it('call a hosted model that cannot call tools chat only', () => {
    expect(byLabel('MythoMax L2 13B').chatOnly).toBe(true)
    expect(byLabel('Qwen 3.6 27B').chatOnly).toBe(false)
  })

  it('promise a free model only to an account whose plan pays', () => {
    expect(byLabel('Qwen3 32B').free?.dailyTokens).toBe(500_000)
    for (const plan of [false, null]) {
      expect(pickerRows(MODELS, plan).every((r) => r.free === null), String(plan)).toBe(true)
    }
  })
})

describe('the marks on the rows', () => {
  it('give the mark to the models measured full and to no partial one', () => {
    const marked = labels(ROWS.filter((r) => r.unfiltered))
    expect(marked).toEqual(PICKER_FIXTURE.filter((m) => m.unfiltered === 'full').map((m) => m.label))
    expect(byLabel('Qwen3 30B A3B').unfiltered).toBe(false)
  })
})

describe('chips', () => {
  it('stand in one fixed order', () => {
    expect(PICKER_FILTERS).toEqual(['marked', 'vision', 'thinking', 'free'])
  })

  it('count over the whole list', () => {
    expect(filterCounts(ROWS)).toEqual({
      marked: PICKER_FIXTURE.filter((m) => m.unfiltered === 'full').length,
      vision: PICKER_FIXTURE.filter((m) => m.vision).length,
      thinking: PICKER_FIXTURE.filter((m) => m.think === 'toggle' || m.think === 'always').length,
      free: PICKER_FIXTURE.filter((m) => m.flash).length,
    })
  })

  it('narrow to the rows that pass, and two chips must both pass', () => {
    expect(filterRows(ROWS, '', only('marked')).every((r) => r.unfiltered)).toBe(true)
    const both = filterRows(ROWS, '', only('marked', 'vision'))
    expect(both.length).toBeGreaterThan(0)
    expect(both.every((r) => r.unfiltered && r.vision)).toBe(true)
    expect(both.length).toBeLessThan(filterRows(ROWS, '', only('marked')).length)
  })

  it('keep nothing for "No credits" on an account that pays for every model', () => {
    expect(filterRows(pickerRows(MODELS, false), '', only('free'))).toEqual([])
    expect(filterCounts(pickerRows(MODELS, false)).free).toBe(0)
  })
})

describe('search', () => {
  it('splits into lower case words', () => {
    expect(searchTokens('  Qwen   3.6 ')).toEqual(['qwen', '3.6'])
    expect(searchTokens('   ')).toEqual([])
  })

  it('finds by label, and several words must all match', () => {
    expect(labels(filterRows(ROWS, 'qwen 3.6', only()))).toEqual(['Qwen 3.6 27B'])
    expect(filterRows(ROWS, 'qwen kimi', only())).toEqual([])
  })

  it('finds by the id and by the family too', () => {
    expect(labels(filterRows(ROWS, 'deepseek-ai', only()))).toEqual(['DeepSeek V3.2', 'DeepSeek R2'])
    // MythoMax has no family of its own, it is listed under Other.
    expect(labels(filterRows(ROWS, 'other', only()))).toContain('MythoMax L2 13B')
  })

  it('works together with a chip', () => {
    const hits = filterRows(ROWS, 'qwen', only('marked'))
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((r) => r.unfiltered && r.label.toLowerCase().includes('qwen'))).toBe(true)
  })
})

describe('families', () => {
  it('reads the family from the id, whatever prefix the store put in front', () => {
    expect(modelFamily('lu-cloud::Qwen/Qwen3.6-27B')).toBe('Qwen')
    expect(modelFamily('lu-cloud::deepseek-ai/DeepSeek-V3.2')).toBe('DeepSeek')
    expect(modelFamily('lu-cloud::moonshotai/Kimi-K3')).toBe('Kimi')
    expect(modelFamily('lu-cloud::Gryphe/MythoMax-L2-13b')).toBe(OTHER_FAMILY)
  })

  it('gives a family with a single model no head of its own', () => {
    const families = assignFamilies(MODELS.map((m) => m.name))
    expect(families.get('lu-cloud::moonshotai/Kimi-K3')).toBe(OTHER_FAMILY)
    expect(families.get('lu-cloud::Qwen/Qwen3.6-27B')).toBe('Qwen')
  })

  it('puts the groups in the fixed order with Other last, rows as given', () => {
    const groups = pickerGroups(ROWS, false)
    expect(groups.map((g) => g.family)).toEqual(['Qwen', 'DeepSeek', 'Llama', OTHER_FAMILY])
    expect(labels(groups[0].rows)).toEqual(labels(ROWS.filter((r) => r.family === 'Qwen')))
    expect(groups.flatMap((g) => g.rows)).toHaveLength(ROWS.length)
  })

  it('drops the heads while a search is active, in the same row order', () => {
    const grouped = pickerGroups(ROWS, false).flatMap((g) => g.rows)
    const flat = pickerGroups(ROWS, true)
    expect(flat).toHaveLength(1)
    expect(flat[0].family).toBeNull()
    expect(labels(flat[0].rows)).toEqual(labels(grouped))
  })

  it('draws no head over a list of one family, and nothing over an empty one', () => {
    const qwen = ROWS.filter((r) => r.family === 'Qwen')
    expect(pickerGroups(qwen, false)).toEqual([{ family: null, rows: qwen }])
    expect(pickerGroups([], false)).toEqual([])
  })

  it('groups any rows that name a family', () => {
    expect(groupByFamily([{ family: OTHER_FAMILY }, { family: 'GLM' }, { family: 'Qwen' }]).map((g) => g.family))
      .toEqual(['Qwen', 'GLM', OTHER_FAMILY])
  })
})

describe('the keyboard cursor', () => {
  it('moves by one with the arrows and stops at both ends', () => {
    expect(moveCursor(0, 'ArrowDown', 5, false)).toBe(1)
    expect(moveCursor(4, 'ArrowDown', 5, false)).toBe(4)
    expect(moveCursor(1, 'ArrowUp', 5, false)).toBe(0)
    expect(moveCursor(0, 'ArrowUp', 5, false)).toBe(0)
  })

  it('moves by ten with Page Up and Page Down', () => {
    expect(moveCursor(2, 'PageDown', 47, false)).toBe(12)
    expect(moveCursor(44, 'PageDown', 47, false)).toBe(46)
    expect(moveCursor(12, 'PageUp', 47, false)).toBe(2)
    expect(moveCursor(3, 'PageUp', 47, false)).toBe(0)
  })

  it('jumps with Home and End only while the search field is empty', () => {
    expect(moveCursor(7, 'Home', 47, false)).toBe(0)
    expect(moveCursor(7, 'End', 47, false)).toBe(46)
    expect(moveCursor(7, 'Home', 47, true)).toBeNull()
    expect(moveCursor(7, 'End', 47, true)).toBeNull()
  })

  it('leaves every other key alone, and an empty list too', () => {
    expect(moveCursor(3, 'a', 47, false)).toBeNull()
    expect(moveCursor(3, 'Enter', 47, false)).toBeNull()
    expect(moveCursor(0, 'ArrowDown', 0, false)).toBe(0)
  })
})

describe('the underline of a hit', () => {
  it('cuts the label into hit and miss', () => {
    expect(highlightParts('Qwen 3.6 27B', ['qwen', '27'])).toEqual([
      { text: 'Qwen', hit: true }, { text: ' 3.6 ', hit: false }, { text: '27', hit: true }, { text: 'B', hit: false },
    ])
  })

  it('returns the label whole without a search', () => {
    expect(highlightParts('Kimi K3', [])).toEqual([{ text: 'Kimi K3', hit: false }])
  })
})

describe('a credit rate', () => {
  it('is printed as whole credits with digit groups, and carries no money sign', () => {
    expect(formatCreditRate(32000)).toBe('32,000')
    expect(formatCreditRate(1234567.4)).toBe('1,234,567')
    expect(formatCreditRate(0)).toBe('0')
    expect(formatCreditRate(320000)).not.toMatch(/[$€£]|usd|eur/i)
  })
})
