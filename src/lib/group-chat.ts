// Group chat v1 (Nurse KillJoy, Discord 2026-08-07): two to four models
// answer in turn inside ONE conversation, SillyTavern-style turn order.
// Plain conversation only by design: the agent path and the chat-tools
// router stay out, a group round is talk, never a tool run.
//
// Attribution is the whole trick. Every model receives the shared history
// with the OTHER models' lines tagged "[model-name] ..." and its own lines
// untagged, so each participant can tell who said what without any provider
// support for multi-speaker roles.
import type { Message } from '../types/chat'
import type { AIModel } from '../types/models'

export const GROUP_CHAT_MIN = 2
export const GROUP_CHAT_MAX = 4

/**
 * The models that may sit at the table.
 *
 * Counter-check round 2 (2026-08-29): the picker listed the whole model store,
 * so `sd_turbo.safetensors`, `Realistic_Vision_V6.0_NV_B1_fp16.safetensors` and
 * `z_image_bf16.safetensors` were offered as conversation partners. An image
 * checkpoint has nothing to say in a talking round. The chat model picker has
 * always filtered on `type === 'text'`; the group picker simply never did.
 *
 * Anything already picked stays in the list even when it fails the test, so a
 * group saved before this fix can still be taken apart by hand instead of
 * showing a member nobody can reach.
 */
export function groupChatCandidates(models: AIModel[], selected: string[] = []): AIModel[] {
  return models.filter((m) => m.type === 'text' || selected.includes(m.name))
}

/** True when this conversation runs as a group. */
export function isGroupChat(groupModels: string[] | undefined): groupModels is string[] {
  return Array.isArray(groupModels) && groupModels.length >= GROUP_CHAT_MIN
}

/**
 * Who sits at the table, and as whom (3.0.5, samvenice on Discord).
 *
 * Until now every model in a group answered under the ONE persona of the
 * chat, so two models were both told "You are Sherlock" and promptly spoke
 * over each other. Each participant can now have its own persona, picked next
 * to its name in the group menu and stored on the conversation
 * (`groupPersonas`, model name to persona id).
 *
 * A participant without an entry is exactly what it was before: it follows
 * the chat's own persona setting and is called by its model name. A persona
 * id that no longer exists (the persona was deleted) reads as no entry, so a
 * stale pick never leaves a participant without a role.
 */
export interface GroupSpeaker {
  /** The name the others see this participant under. */
  name: string
  /** Its own persona prompt, absent when it follows the chat's setting. */
  personaPrompt?: string
}

export function groupSpeakers(
  models: readonly string[],
  groupPersonas: Readonly<Record<string, string>> | undefined,
  personas: readonly { id: string; name: string; systemPrompt: string }[],
): Record<string, GroupSpeaker> {
  const picked = models.map((model) => {
    const id = groupPersonas?.[model]
    return { model, persona: id ? personas.find((p) => p.id === id) : undefined }
  })
  const speakers: Record<string, GroupSpeaker> = {}
  for (const { model, persona } of picked) {
    if (!persona) {
      speakers[model] = { name: model }
      continue
    }
    // Two participants on the same persona still need two names, or the tags
    // in the shared history could not tell them apart.
    const shared = picked.filter((other) => other.persona?.name === persona.name).length > 1
    speakers[model] = {
      name: shared ? `${persona.name} (${model})` : persona.name,
      personaPrompt: persona.systemPrompt,
    }
  }
  return speakers
}

/** True when at least one participant speaks as a persona of its own. */
export function hasOwnPersonas(speakers: Readonly<Record<string, GroupSpeaker>> | undefined): speakers is Record<string, GroupSpeaker> {
  return !!speakers && Object.values(speakers).some((s) => s.personaPrompt !== undefined)
}

export function groupSystemPrompt(
  model: string,
  allModels: string[],
  personaPrompt: string,
  /** From `groupSpeakers`. Without own personas the wording stays the one
   *  every group has had since v1. */
  speakers?: Readonly<Record<string, GroupSpeaker>>,
): string {
  let line: string
  if (hasOwnPersonas(speakers)) {
    const nameOf = (m: string) => speakers[m]?.name ?? m
    const self = nameOf(model)
    const others = allModels.filter((m) => m !== model).map((m) => `"${nameOf(m)}"`).join(', ')
    // The role belongs to ONE participant. Saying so, and naming the others,
    // is what keeps a model from answering as the character next to it.
    line =
      `In this group conversation you are "${self}" and only "${self}". The other participants are ${others}. ` +
      `What they said arrives as user messages that start with a [name] tag; the assistant messages are your own earlier turns. ` +
      `Stay in your own role: never speak as another participant and never write their lines. ` +
      `Add something new, and do not repeat what another participant already said.`
  } else {
    const others = allModels.filter((m) => m !== model).map((m) => `"${m}"`).join(', ')
    line =
      `You are "${model}", one of several AI models answering in the same group conversation with ${others}. ` +
      `What the other models said arrives as user messages that start with a [model-name] tag; the assistant messages are your own earlier turns. ` +
      `Answer as yourself in your own voice, add something new, and do not repeat what another model already said.`
  }
  return personaPrompt ? `${personaPrompt}\n\n${line}` : line
}

export interface GroupWireMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: { data: string; mimeType: string }[]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A model's OWN lines go over the wire untagged; the other speakers arrive
 *  tagged "[model-id] …". So a "[other-model] …" line in a model's own reply can
 *  only be fabrication: a weak model (two Phi-4-mini in one group, Discord
 *  2026-08-08) copies the format and appends a line pretending to BE the next
 *  speaker. v1 let that through. Cut from the first line that starts with another
 *  participant's exact tag to the end. Line-anchored and exact-id-only, so an
 *  inline mention ("I agree with [other]") or an ordinary "[note]" in prose is
 *  untouched; only a fabricated turn header is removed. */
export function stripImpersonatedSpeakers(text: string, otherModels: string[]): string {
  const ids = otherModels.filter((m) => m.trim()).map(escapeRegExp)
  if (!ids.length) return text
  const tag = new RegExp(`^[ \\t>]*\\[(?:${ids.join('|')})\\]`)
  const lines = text.split('\n')
  const cut = lines.findIndex((l) => tag.test(l))
  return cut === -1 ? text : lines.slice(0, cut).join('\n').trim()
}

/** The shared history as one model sees it: the OTHER speakers arrive as
 *  tagged user turns, this model's own turns stay assistant, empty
 *  placeholders and app notices are dropped.
 *
 *  Bug B3: role:'system' is an app notice here, not a turn. The caller puts the
 *  group system prompt at index 0 itself, so letting a stored one through would
 *  hand the engine a second system message somewhere in the middle, and a strict
 *  Jinja chat template refuses that outright with "System message must be at the
 *  beginning".
 *
 *  Bug B3 round 2: the other speakers used to arrive as assistant turns, tagged
 *  but assistant all the same. From round two on that puts two assistant
 *  messages next to each other in every payload, one per speaker, and a
 *  template that demands strict user/assistant alternation raises on it. The
 *  counter-check killed both speakers of a two-model group that way on the
 *  installed 2.6.7 build. A foreign turn is not this model's own speech, so
 *  the honest role for it is user; the [model-name] tag and the system prompt
 *  above say who is talking, which is how attribution worked all along. It
 *  also fixes round one for the second speaker, whose prompt used to end on
 *  somebody else's assistant turn and asked it to carry on mid-sentence. */
export function groupHistory(
  messages: Message[],
  model: string,
  /** From `groupSpeakers`: a participant with its own persona is tagged with
   *  that name, everyone else with the model name as before. */
  speakers?: Readonly<Record<string, GroupSpeaker>>,
): GroupWireMessage[] {
  return messages
    .filter((m) => m.role !== 'system' && m.content.trim() !== '')
    .map((m) => {
      const foreign = m.role === 'assistant' && !!m.modelId && m.modelId !== model
      return {
        role: (foreign ? 'user' : m.role) as GroupWireMessage['role'],
        content: foreign ? `[${speakers?.[m.modelId!]?.name ?? m.modelId}] ${m.content}` : m.content,
        ...(m.images?.length ? { images: m.images.map((i) => ({ data: i.data, mimeType: i.mimeType })) } : {}),
      }
    })
}
