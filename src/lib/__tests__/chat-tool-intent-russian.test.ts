/**
 * The Russian patterns and the attached-photo edit rule of the plain-chat
 * intent detector (FINDINGS 1). Every row of the finding's table is here as a
 * message that must stay on the plain path, next to the requests the
 * patterns exist for.
 *
 * Run: npx vitest run src/lib/__tests__/chat-tool-intent-russian.test.ts
 */
import { describe, it, expect } from 'vitest'
import { detectChatToolCapability as detect } from '../chat-tool-intent'

describe('ordinary messages stay on the plain path (FINDINGS 1)', () => {
  it.each([
    ['Мне нужно описание картины Моне', false],
    ['хочу купить фотоаппарат', false],
    ['нужна помощь с фотошопом', false],
    ['покажи видео про котов на ютубе', false],
    ['Add up the totals on this receipt', true],
    ['Turn this receipt into a table', true],
    ['Change of plans: summarize this screenshot', true],
    ['Remove duplicates from this list', true],
    ['убери дубликаты из списка', true],
    ['что бы ты изменил на этом фото?', true],
    ['what would you change in this photo?', true],
    ['расскажи про фотосинтез', false],
  ])('%s', (text, hasImages) => {
    expect(detect(text, hasImages)).toBe(null)
  })
})

describe('the requests the patterns exist for still route', () => {
  it.each([
    ['нарисуй кота в космосе', false, 'image'],
    ['сделай картинку заката', false, 'image'],
    ['создай логотип для кофейни', false, 'image'],
    ['сгенерируй фото горного озера', false, 'image'],
    ['сделай видео с волнами', false, 'video'],
    ['анимируй это', true, 'video'],
    ['убери машину на заднем плане', true, 'image'],
    ['сделай фон снежным', true, 'image'],
    ['перекрась в синий', true, 'image'],
    ['remove the car', true, 'image'],
    ['change the sky to night', true, 'image'],
    ['retouch it', true, 'image'],
  ])('%s', (text, hasImages, want) => {
    expect(detect(text, hasImages)).toBe(want)
  })
})
