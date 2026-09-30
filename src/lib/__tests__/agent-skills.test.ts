import { describe, it, expect } from 'vitest'
import { AGENT_SKILLS, matchSkills, renderSkillSection, skillTools, MAX_SKILLS_PER_TURN } from '../agent-skills'

const ids = (text: string, hasImages = false) => matchSkills(text, { hasImages }).map((s) => s.id)

describe('matchSkills: the turns that went wrong in the field', () => {
  it('"убери бикини пускай будет красивая грудь" with a photo in the chat is an edit, not a LoRA search', () => {
    expect(ids('убери бикини пускай будет красивая грудь', true)).toEqual(['edit-attached-photo'])
  })
  it('"отредактируй прикреплённое фото, LoRA не ищи" is an edit (the photo came in an earlier message)', () => {
    expect(ids('отредактируй прикреплённое фото, LoRA не ищи', true)).toEqual(['edit-attached-photo'])
  })
  it('English and German edits of an attached photo', () => {
    expect(ids('remove the car from this photo', true)).toEqual(['edit-attached-photo'])
    expect(ids('make the background snowy', true)).toEqual(['edit-attached-photo'])
    expect(ids('bearbeite das angehängte Foto', true)).toEqual(['edit-attached-photo'])
  })
})

describe('matchSkills: each skill', () => {
  it('animate an attached photo', () => {
    expect(ids('оживи это фото', true)).toEqual(['animate-attached-photo'])
    expect(ids('animate this picture', true)).toEqual(['animate-attached-photo'])
  })
  it('a CivitAI image link, on either host', () => {
    expect(ids('сделай так же https://civitai.red/images/12345')).toContain('remake-civitai-image')
    expect(ids('make this https://civitai.com/images/987?x=1')).toContain('remake-civitai-image')
  })
  it('find and download a LoRA', () => {
    expect(ids('найди LoRA для аниме стиля')).toEqual(['find-lora'])
    expect(ids('download a lora for pixel art')).toEqual(['find-lora'])
  })
  it('generate an image or a video from text', () => {
    expect(ids('нарисуй кота в космосе')).toEqual(['generate-image'])
    expect(ids('make a video of a cat running')).toEqual(['generate-video'])
  })
  it('an edit and a plain generate never load together', () => {
    const hit = ids('сделай картинку ярче', true)
    expect(hit).toContain('edit-attached-photo')
    expect(hit).not.toContain('generate-image')
  })
})

describe('matchSkills: what must NOT load a skill', () => {
  it('ordinary conversation', () => {
    expect(ids('привет, как дела?')).toEqual([])
    expect(ids('explain how LoRA training works')).toEqual([])
    expect(ids('what is in this photo?', false)).toEqual([])
  })
  it('an edit verb without any picture in the conversation', () => {
    expect(ids('убери дубликаты из списка', false)).toEqual([])
    expect(ids('remove the duplicates', false)).toEqual([])
  })
  it('an empty message', () => {
    expect(ids('')).toEqual([])
  })
  it('never more than MAX_SKILLS_PER_TURN', () => {
    const many = matchSkills('найди lora и нарисуй картинку https://civitai.com/images/1', { hasImages: false })
    expect(many.length).toBeLessThanOrEqual(MAX_SKILLS_PER_TURN)
  })
})

describe('skillTools and renderSkillSection', () => {
  it('pins exactly the tools the recipes call, once each', () => {
    const edit = AGENT_SKILLS.filter((s) => s.id === 'edit-attached-photo' || s.id === 'generate-image')
    expect(skillTools(edit)).toEqual(['image_generate'])
  })
  it('the edit recipe names the attachment reference and warns off LoRA searches', () => {
    const text = renderSkillSection(matchSkills('убери бикини', { hasImages: true }))
    expect(text).toContain('# Skills for this request')
    expect(text).toContain('inputImage "attached"')
    expect(text).toContain('Do not call media_list')
    expect(text).toContain('denoise')
  })
  it('no skill, no section', () => {
    expect(renderSkillSection([])).toBe('')
  })
  it('every skill names only tools that exist in the builtin catalog', async () => {
    const { toolRegistry } = await import('../../api/mcp/index')
    const names = new Set(toolRegistry.getAll().map((t) => t.name))
    for (const s of AGENT_SKILLS) for (const t of s.tools) expect(names.has(t), `${s.id}: ${t}`).toBe(true)
  })
})
