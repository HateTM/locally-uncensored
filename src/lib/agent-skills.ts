/**
 * Agent skills: short, exact recipes for the tasks people actually bring to
 * the agent, loaded into the turn that needs one.
 *
 * Why. The agent loop hands the model a catalog and a general prompt and lets
 * it work out the rest. A 9B-12B local model often does not: asked to edit an
 * attached photo it went looking for LoRAs on CivitAI until the tool timed
 * out, and under Small-Model Mode (6 tools, 4 of them file tools) the tool it
 * needed was frequently not in the list at all. A skill fixes both halves:
 *
 *   - its `steps` go into the system prompt of that turn, so the model is told
 *     which tool to call with which arguments, in which order;
 *   - its `tools` are pinned into the tool list past the Small-Model cap
 *     (tool-selection.ts `pin`), so the tool the recipe names is there.
 *
 * Shaped like a SKILL.md (a name, a one-line description, the body), so a skill
 * reads the same whether it ships here or is written by a user later. Matching
 * is deterministic (the same patterns chat-tool-intent uses, English, German
 * and Russian): a small model is never asked to decide which skill to load.
 *
 * Pure: no imports from the loop, no store. useAgentChat calls matchSkills and
 * renderSkillSection; the tests call everything.
 */
import { detectChatToolCapability, entumlauten } from './chat-tool-intent'
import { civitaiImageId } from './civitai-image-meta'

export interface SkillContext {
  /** The user attached a picture in this conversation (this message or an earlier one). */
  hasImages: boolean
}

export interface AgentSkill {
  /** Stable id, kebab-case (the SKILL.md `name`). */
  id: string
  /** One line: what the skill is for. */
  description: string
  /** Does this turn need the skill? Deterministic, cheap. */
  when: (text: string, ctx: SkillContext) => boolean
  /** Tools the recipe calls; pinned into the turn's tool list. */
  tools: string[]
  /** The recipe itself, written to the model. */
  steps: string[]
}

const norm = (s: string) => entumlauten((s || '').toLowerCase())

// "the attached photo", "this picture", "прикреплённое фото", "это фото".
const ATTACHED_REF_RE = /\b(attached|this|that|my|the)\s+(photo|picture|image|pic)\b|\b(angehaengte?s?|dieses?|mein(e|en)?)\s+(foto|bild)\b|(?<![а-я])(прикрепл[её]нн[а-я]*|приложенн[а-я]*|эт[оу]|мо[её]|мою)\s+(фото[а-я]*|картинк[а-я]*|изображени[а-я]*)(?![а-я])/i
// Editing verbs on their own. With a picture in the conversation an
// imperative "remove / change / убери / сделай" is almost always about it.
const EDIT_VERB_RE = /^(please\s+|pls\s+|now\s+)?(edit|remove|replace|change|add|erase|make|put|turn|retouch|inpaint|restyle|recolou?r)\b|\b(bearbeite|entferne|ersetze|aendere|mach\w*)\b|(?<![а-я])(измени(те)?|отредактируй(те)?|редактируй(те)?|убери(те)?|удали(те)?|замени(те)?|поменяй(те)?|добавь(те)?|вырежи(те)?|сотри(те)?|перекрась(те)?|сделай(те)?|пусть)(?![а-я])/i
const ANIMATE_RE = /\b(animate|bring\s+(it\s+)?to\s+life|make\s+it\s+move|animier\w*)\b|(?<![а-я])(анимируй(те)?|анимировать|оживи(те)?|оживить|сделай(те)?\s+(из\s+него\s+|из\s+неё\s+)?видео)(?![а-я])/i
const LORA_RE = /\blora(s)?\b|(?<![а-я])лор[аыу](?![а-я])/i
const LORA_FIND_RE = /\b(find|search|download|get|install|look\s+for|such\w*|lade\w*|hol\w*)\b|(?<![а-я])(найди(те)?|найти|скачай(те)?|скачать|загрузи(те)?|поищи(те)?|установи(те)?)(?![а-я])/i

export const AGENT_SKILLS: AgentSkill[] = [
  {
    id: 'remake-civitai-image',
    description: 'Recreate a CivitAI image from its link, with its prompt, settings and LoRAs.',
    when: (t) => civitaiImageId(t.match(/https?:\/\/\S*civitai\.(?:com|red)\/images\/\d+\S*/i)?.[0] ?? '') !== null,
    tools: ['media_list', 'lora_download', 'image_generate'],
    steps: [
      'Call media_list with civitaiImage set to the link. It returns the prompt, negative prompt, settings and LoRAs.',
      'For every LoRA marked NOT installed that has a versionId, call lora_download with that versionId. Skip the others.',
      'Call image_generate once with the recipe\'s prompt, negativePrompt and settings, and settings.lora / loraStrength for the installed LoRAs.',
      'If CivitAI does not answer, say so in one line and stop; do not guess the recipe.',
    ],
  },
  {
    id: 'animate-attached-photo',
    description: 'Turn a picture the user attached into a short video.',
    when: (t, ctx) => ctx.hasImages && ANIMATE_RE.test(t),
    tools: ['video_generate'],
    steps: [
      'Call video_generate once with inputImage "attached" and a prompt that describes the MOTION (what moves, how, the camera), in English.',
      'You do not need to see the picture. Do not search for LoRAs or models unless the user asked for one.',
      'When it finishes, say in one line that the video is ready.',
    ],
  },
  {
    id: 'edit-attached-photo',
    description: 'Change a picture the user attached (remove, replace, restyle, undress, recolour).',
    when: (t, ctx) => ctx.hasImages && !ANIMATE_RE.test(t)
      && (detectChatToolCapability(t, true) === 'image' || EDIT_VERB_RE.test(t) || ATTACHED_REF_RE.test(t)),
    tools: ['image_generate'],
    steps: [
      'Call image_generate once with inputImage "attached". You do not need to see the picture: the tool takes it from the chat.',
      'Write the prompt in English as a description of the WHOLE finished picture (subject, pose, clothing, setting, light), with the change already made, not as an instruction.',
      'Set denoise: about 0.5 to keep the picture close to the original, 0.7 to 0.8 for a strong change. Default 0.65.',
      'Do not call media_list or search for LoRAs unless the user asked for a LoRA or a specific model.',
      'For a change to one exact area only, tell the user that Create, Edit / Image to Image with a painted mask keeps the rest untouched.',
    ],
  },
  {
    id: 'find-lora',
    description: 'Find a LoRA on CivitAI and download it.',
    when: (t) => LORA_RE.test(t) && LORA_FIND_RE.test(t),
    tools: ['media_list', 'lora_download'],
    steps: [
      'Call media_list with search set to 2-4 English words for the style or character. Use it once; if it comes back empty, try other words once, then stop.',
      'Pick the hit whose base model matches the image model the user renders with, and call lora_download with its id.',
      'Tell the user its file name and trigger words; they are added to prompts automatically.',
    ],
  },
  {
    id: 'generate-video',
    description: 'Make a video from a description.',
    when: (t, ctx) => detectChatToolCapability(t, ctx.hasImages) === 'video' && !(ctx.hasImages && ANIMATE_RE.test(t)),
    tools: ['video_generate'],
    steps: [
      'Call video_generate once with a prompt in English: subject, action, setting, camera, light.',
      'Do not search for LoRAs or models unless the user asked for one.',
    ],
  },
  {
    id: 'generate-image',
    description: 'Make a picture from a description.',
    when: (t, ctx) => detectChatToolCapability(t, false) === 'image' && !ctx.hasImages,
    tools: ['image_generate'],
    steps: [
      'Call image_generate once with a detailed prompt in English: subject, style, composition, light, colours.',
      'Do not search for LoRAs or models unless the user asked for one. Use media_list only if the user named a model or LoRA you need to check.',
    ],
  },
]

/** Most skills a turn loads: one recipe is clear, three compete. */
export const MAX_SKILLS_PER_TURN = 2

/** The skills this turn needs, most specific first (AGENT_SKILLS order). */
export function matchSkills(text: string, ctx: SkillContext, skills: readonly AgentSkill[] = AGENT_SKILLS): AgentSkill[] {
  const t = norm(text).trim()
  if (!t) return []
  const hits: AgentSkill[] = []
  for (const s of skills) {
    if (hits.length >= MAX_SKILLS_PER_TURN) break
    try {
      if (s.when(t, ctx)) hits.push(s)
    } catch {
      // A broken matcher must never take the turn down with it.
    }
  }
  // An edit and a generic generate for the same picture say two things: the edit wins.
  if (hits.some((s) => s.id === 'edit-attached-photo')) return hits.filter((s) => s.id !== 'generate-image')
  return hits
}

/** The tools the matched skills call, for tool-selection's `pin`. */
export function skillTools(skills: readonly AgentSkill[]): string[] {
  return [...new Set(skills.flatMap((s) => s.tools))]
}

/** The system prompt section for the matched skills; '' when none matched. */
export function renderSkillSection(skills: readonly AgentSkill[]): string {
  if (skills.length === 0) return ''
  const blocks = skills.map((s) => `## Skill: ${s.id}\n${s.description}\n${s.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}`)
  return `\n\n# Skills for this request\nFollow these steps for this request; they take precedence over general habits.\n\n${blocks.join('\n\n')}`
}
