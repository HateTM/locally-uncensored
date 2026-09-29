/**
 * Executors for the agent's media tools beyond generating: what is installed
 * (media_list), getting a LoRA (lora_download) and saving a repeatable setup
 * (workflow_create). Their definitions sit in builtin-tools.ts' BUILTIN_TOOLS,
 * where the catalogue guards (tool-classification, parity) read them.
 *
 * Everything heavy is imported lazily, the same way builtin-tools reaches the
 * generators: this module sits under the tool registry, and a static edge into
 * the ComfyUI or store graph from here is the kind that grows an import cycle.
 */
import { v4 as uuid } from 'uuid'
import type { ToolArgs } from './types'
import type { AgentRunContext } from '../agent-context'
import type { WorkflowStep } from '../../types/agent-workflows'

const LIST_CAP = 40
const LORA_WAIT_MS = 20 * 60_000
const POLL_MS = 2_000

function list(label: string, items: string[]): string {
  if (items.length === 0) return `${label}: none`
  const shown = items.slice(0, LIST_CAP).join(', ')
  return `${label} (${items.length}): ${shown}${items.length > LIST_CAP ? ', …' : ''}`
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function civitaiAuth(): Promise<{ apiKey?: string; host: string }> {
  const { useWorkflowStore } = await import('../../stores/workflowStore')
  const st = useWorkflowStore.getState()
  return { apiKey: st.civitaiApiKey || undefined, host: st.civitaiHost }
}

// ── media_list ──────────────────────────────────────────────────

export async function executeMediaList(args: ToolArgs): Promise<string> {
  const image = typeof args.civitaiImage === 'string' ? args.civitaiImage.trim()
    : typeof args.civitaiImage === 'number' ? String(args.civitaiImage) : ''
  if (image) return civitaiRecipe(image)
  const search = typeof args.search === 'string' ? args.search.trim() : ''
  if (search) return searchLoras(search)

  const lines: string[] = []
  const { isMlxImageHost, listMlxImageModels } = await import('../mlx-image')
  if (isMlxImageHost()) {
    const { listVideoModels } = await import('../mlx-video')
    const [img, vid] = await Promise.all([
      listMlxImageModels().catch(() => []),
      listVideoModels().catch(() => []),
    ])
    lines.push(list('Image models (MLX)', img.filter((m) => m.installed).map((m) => m.name)))
    lines.push(list('Video models (MLX)', vid.filter((m) => m.installed).map((m) => m.name)))
  } else {
    const comfy = await import('../comfyui')
    if (!(await comfy.checkComfyConnection())) {
      lines.push('ComfyUI is not running, so installed models cannot be listed. image_generate starts it on its own.')
    } else {
      const nodes = await import('../comfyui-nodes')
      const [img, vid, loras, vaes, info] = await Promise.all([
        comfy.getImageModels().catch(() => []),
        comfy.getVideoModels().catch(() => []),
        comfy.getLoraModels().catch(() => []),
        comfy.getVAEModels().catch(() => []),
        nodes.getAllNodeInfo(true).catch(() => ({})),
      ])
      lines.push(list('Image models', img.map((m) => `${m.name} [${m.type}]`)))
      lines.push(list('Video models', vid.map((m) => `${m.name} [${m.type}]`)))
      const { useLoraInfoStore } = await import('../../stores/loraInfoStore')
      const { loraAddition } = await import('../../lib/lora-auto')
      const { prompts, known } = useLoraInfoStore.getState()
      lines.push(list('LoRAs', loras.map((l) => {
        const add = loraAddition(l, prompts, known)
        return add ? `${l} (auto prompt: ${add})` : l
      })))
      lines.push(list('VAEs', vaes))
      lines.push(list('Samplers', nodes.getSamplerOptions(info)))
      lines.push(list('Schedulers', nodes.getSchedulerOptions(info)))
      const has = (n: string) => n in info
      const { bgRemovalStatus } = await import('../bg-removal')
      lines.push(`Background removal: ${bgRemovalStatus(info)}. `
        + `Inpaint: ${has('VAEEncodeForInpaint') ? 'available' : 'not available'}.`)
    }
  }
  const { useAgentWorkflowStore } = await import('../../stores/agentWorkflowStore')
  const { useWorkflowStore } = await import('../../stores/workflowStore')
  lines.push(list('Agent workflows (run_workflow)', useAgentWorkflowStore.getState().workflows.map((w) => w.name)))
  lines.push(list('Generation presets (Create tab)', useWorkflowStore.getState().installedWorkflows.map((w) => w.name)))
  return lines.join('\n')
}

async function searchLoras(query: string): Promise<string> {
  const { searchCivitaiModels } = await import('../discover')
  const { apiKey, host } = await civitaiAuth()
  const hits = (await searchCivitaiModels(query, 'LORA', apiKey, host)).filter((h) => h.downloadUrl).slice(0, 8)
  if (hits.length === 0) return `No CivitAI LoRA found for "${query}" (or CivitAI did not answer). Try other words.`
  const rows = hits.map((h) => {
    const bits = [
      h.baseModel ? `base ${h.baseModel}` : '',
      h.sizeGB ? `${h.sizeGB} GB` : '',
      h.stats ? `${h.stats.downloads} downloads` : '',
      h.trainedWords?.length ? `triggers: ${h.trainedWords.slice(0, 5).join(', ')}` : '',
    ].filter(Boolean)
    return `id ${h.id}: ${h.name} (${bits.join('; ')}) file ${h.filename}`
  })
  return `CivitAI LoRAs for "${query}":\n${rows.join('\n')}\n`
    + 'Pick one whose base matches the image model, then call lora_download with its id.'
}

/**
 * "Make it like this CivitAI image": its recipe, translated to image_generate
 * arguments, with every LoRA marked installed or not.
 */
async function civitaiRecipe(ref: string): Promise<string> {
  const { civitaiImageId, civitaiHostOf, parseCivitaiImage } = await import('../../lib/civitai-image-meta')
  const id = civitaiImageId(ref)
  if (!id) return `Error: "${ref}" is not a CivitAI image link (civitai.com/images/<id>) or id.`
  const auth = await civitaiAuth()
  const host = civitaiHostOf(ref) ?? auth.host
  const { fetchExternal } = await import('../backend')
  let recipe: ReturnType<typeof parseCivitaiImage>
  try {
    recipe = parseCivitaiImage(JSON.parse(await fetchExternal(`https://${host}/api/v1/images?imageId=${id}&nsfw=X`, auth.apiKey ?? null)))
  } catch (e) {
    return `Error: CivitAI did not answer for image ${id}: ${errText(e)}`
  }
  if (!recipe) return `CivitAI image ${id} carries no generation data (its creator hid it, or it was not generated with a tool that records it).`

  const comfy = await import('../comfyui')
  const up = await comfy.checkComfyConnection()
  const [installedLoras, models] = up
    ? await Promise.all([comfy.getLoraModels().catch(() => [] as string[]), comfy.getImageModels().catch(() => [])])
    : [[] as string[], []]
  const { resolveModelName } = await import('../vram-handoff')
  const stem = (n: string) => n.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const loraLines = recipe.loras.map((l) => {
    // A name with no letters or digits has an empty stem, and every file
    // "includes" the empty string: it read as installed. No stem, no match.
    const want = stem(l.name)
    const have = want ? installedLoras.find((f) => stem(f) === want || stem(f).includes(want)) : undefined
    return have
      ? `- ${l.name} weight ${l.weight}: installed as ${have}`
      : `- ${l.name} weight ${l.weight}: NOT installed${l.versionId ? ` (lora_download versionId ${l.versionId})` : ' (search it with media_list search)'}`
  })
  const localModel = recipe.checkpoint && models.length ? resolveModelName(recipe.checkpoint, models) : null
  const settings: Record<string, unknown> = {
    ...(recipe.sampler ? { sampler: recipe.sampler } : {}),
    ...(recipe.scheduler ? { scheduler: recipe.scheduler } : {}),
    ...(recipe.steps !== undefined ? { steps: recipe.steps } : {}),
    ...(recipe.cfg !== undefined ? { cfg: recipe.cfg } : {}),
    ...(recipe.seed !== undefined ? { seed: recipe.seed } : {}),
    ...(recipe.width ? { width: recipe.width, height: recipe.height } : {}),
    ...(recipe.clipSkip !== undefined ? { clipSkip: recipe.clipSkip } : {}),
  }
  return [
    `Recipe of CivitAI image ${id}:`,
    `prompt: ${recipe.prompt}`,
    recipe.negativePrompt ? `negativePrompt: ${recipe.negativePrompt}` : 'negativePrompt: (none)',
    `settings: ${JSON.stringify(settings)}${recipe.samplerLabel ? ` (sampler was "${recipe.samplerLabel}")` : ''}`,
    `checkpoint: ${recipe.checkpoint ?? 'unknown'}${recipe.baseModel ? ` [${recipe.baseModel}]` : ''}`
      + (localModel ? `, closest installed: ${localModel}` : up ? ', no matching installed model: pick one of the same family' : ''),
    recipe.loras.length ? `LoRAs:\n${loraLines.join('\n')}` : 'LoRAs: none',
    'To reproduce: lora_download the missing LoRAs, then image_generate with this prompt, negativePrompt and settings, plus settings.lora / loraStrength for the LoRAs.',
  ].join('\n')
}

// ── lora_download ───────────────────────────────────────────────

export async function executeLoraDownload(args: ToolArgs, run?: AgentRunContext, signal?: AbortSignal): Promise<string> {
  const rawId = typeof args.id === 'number' ? args.id : typeof args.id === 'string' ? Number(args.id.replace(/\D+/g, '')) : NaN
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const versionId = typeof args.versionId === 'number' ? args.versionId : Number(args.versionId)
  if (!(rawId > 0) && !query && !(versionId > 0)) {
    return 'lora_download: `id` (a CivitAI model id from media_list search), `versionId` or `query` is required. Nothing was downloaded.'
  }
  const discover = await import('../discover')
  const { apiKey, host } = await civitaiAuth()
  const hit = versionId > 0
    ? await discover.getCivitaiModelVersion(versionId, apiKey, host)
    : rawId > 0
      ? await discover.getCivitaiModel(rawId, 'LORA', apiKey, host)
      : (await discover.searchCivitaiModels(query, 'LORA', apiKey, host)).find((h) => h.downloadUrl) ?? null
  const what = versionId > 0 ? `version ${versionId}` : rawId > 0 ? `id ${rawId}` : `"${query}"`
  if (!hit || !hit.downloadUrl || !hit.filename) {
    return `Error: CivitAI has no downloadable LoRA for ${what}.`
  }
  if (versionId > 0 && hit.subfolder !== 'loras') {
    return `Error: CivitAI ${what} is a ${hit.type || 'non-LoRA'} file, not a LoRA. Only LoRAs download here.`
  }
  const filename = hit.filename
  // Its trigger words go into every later prompt that uses it (lib/lora-auto.ts).
  const { rememberLoraHit } = await import('../../stores/loraInfoStore')
  rememberLoraHit(hit)
  const usage = `Use it: image_generate settings.lora = "${filename}".`
    + (hit.trainedWords?.length ? ` Its trigger words (${hit.trainedWords.slice(0, 5).join(', ')}) are added to the prompt automatically.` : '')
    + (hit.baseModel ? ` Trained for ${hit.baseModel}; it only fits image models of that family.` : '')

  const comfy = await import('../comfyui')
  const installed = await comfy.getLoraModels().catch(() => [] as string[])
  if (installed.some((n) => n.replace(/^.*[\\/]/, '') === filename)) {
    return `${hit.name} is already installed as ${filename}. ${usage}`
  }

  const { useDownloadStore } = await import('../../stores/downloadStore')
  useDownloadStore.getState().setMeta(filename, hit.downloadUrl, 'loras')
  let started: { status: string; id: string; error?: string }
  try {
    started = await discover.startModelDownload(hit.downloadUrl, 'loras', filename)
  } catch (e) {
    return `Error: the download of ${filename} did not start: ${errText(e)}`
  }
  if (started.error || started.status === 'error') {
    return `Error: the download of ${filename} did not start: ${started.error ?? started.status}`
  }

  const deadline = Date.now() + LORA_WAIT_MS
  // A progress read that throws (backend busy, a dev-server restart) is one
  // missed poll, not a failed download: the download runs on regardless. It
  // used to throw out of the tool call and the agent saw a raw error.
  let pollError: string | null = null
  while (Date.now() < deadline) {
    if (signal?.aborted || run?.abortSignal?.aborted) {
      return `Stopped waiting. ${filename} keeps downloading in the background; the downloads tray in the header shows its progress.`
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
    let prog: Awaited<ReturnType<typeof discover.getDownloadProgress>>
    try {
      prog = await discover.getDownloadProgress()
      pollError = null
    } catch (e) {
      pollError = errText(e)
      continue
    }
    const entry = prog[started.id] ?? Object.values(prog).find((d) => d.filename === filename)
    if (entry?.status === 'error') return `Error: the download of ${filename} failed: ${entry.error ?? 'unknown error'}`
    if (entry?.status === 'complete') {
      const { clearNodeCache } = await import('../comfyui-nodes')
      clearNodeCache()
      return `Downloaded ${hit.name} into models/loras as ${filename}. ${usage}`
    }
  }
  if (pollError) {
    return `${filename} was started, but its progress could not be read (${pollError}). The downloads tray in the header shows whether it finished; call media_list later to see it listed.`
  }
  return `${filename} is still downloading; the downloads tray in the header shows its progress. Call media_list later to see it listed.`
}

// ── workflow_create ─────────────────────────────────────────────

interface StepInput {
  label?: unknown
  tool?: unknown
  args?: unknown
  prompt?: unknown
}

/**
 * Turn the model's step list into WorkflowSteps. String arguments that carry a
 * {{variable}} become templates, everything else stays static. Exported for
 * unit tests.
 */
export function buildChainSteps(raw: unknown, hasTool: (name: string) => boolean): WorkflowStep[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'workflow_create: `steps` must be a non-empty array.'
  if (raw.length > 30) return 'workflow_create: at most 30 steps.'
  const steps: WorkflowStep[] = []
  for (const [i, s] of (raw as StepInput[]).entries()) {
    const n = i + 1
    if (!s || typeof s !== 'object') return `workflow_create: step ${n} is not an object.`
    const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim() : `Step ${n}`
    if (typeof s.tool === 'string' && s.tool) {
      if (!hasTool(s.tool)) return `workflow_create: step ${n} names an unknown tool "${s.tool}".`
      const toolArgs: Record<string, unknown> = {}
      const toolArgTemplates: Record<string, string> = {}
      if (s.args && typeof s.args === 'object' && !Array.isArray(s.args)) {
        for (const [k, v] of Object.entries(s.args as Record<string, unknown>)) {
          if (typeof v === 'string' && v.includes('{{')) toolArgTemplates[k] = v
          else toolArgs[k] = v
        }
      }
      steps.push({
        id: uuid(), type: 'tool', label, toolName: s.tool, toolArgs,
        ...(Object.keys(toolArgTemplates).length ? { toolArgTemplates } : {}),
      })
    } else if (typeof s.prompt === 'string' && s.prompt.trim()) {
      steps.push({ id: uuid(), type: 'prompt', label, prompt: s.prompt })
    } else {
      return `workflow_create: step ${n} needs either \`tool\` (with optional \`args\`) or \`prompt\`.`
    }
  }
  return steps
}

export async function executeWorkflowCreate(args: ToolArgs, hasTool: (name: string) => boolean): Promise<string> {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  if (!name) return 'workflow_create: `name` is required — a non-empty string. Nothing was saved.'
  const description = typeof args.description === 'string' ? args.description : ''
  const kind = args.kind === 'preset' ? 'preset' : 'chain'
  return kind === 'preset' ? savePreset(name, description, args) : saveChain(name, description, args, hasTool)
}

async function saveChain(name: string, description: string, args: ToolArgs, hasTool: (n: string) => boolean): Promise<string> {
  const steps = buildChainSteps(args.steps, hasTool)
  if (typeof steps === 'string') return steps
  const { useAgentWorkflowStore } = await import('../../stores/agentWorkflowStore')
  const store = useAgentWorkflowStore.getState()
  const existing = store.workflows.find((w) => w.name.toLowerCase() === name.toLowerCase())
  if (existing?.isBuiltIn) return `workflow_create: "${existing.name}" is a built-in workflow. Pick another name.`
  if (existing) store.updateWorkflow(existing.id, { description, steps })
  else store.addWorkflow({ name, description, icon: 'Workflow', steps, variables: {}, isBuiltIn: false })
  return `${existing ? 'Updated' : 'Saved'} agent workflow "${name}" with ${steps.length} step(s). `
    + `Run it with run_workflow name "${name}" (its \`input\` fills {{user_input}}); it also shows in the Workflows panel.`
}

async function savePreset(name: string, description: string, args: ToolArgs): Promise<string> {
  const comfy = await import('../comfyui')
  if (!(await comfy.checkComfyConnection())) {
    return 'Error: ComfyUI is not running. Generate one image first (that starts it), then save the preset.'
  }
  const settings = args.settings && typeof args.settings === 'object' ? args.settings as Record<string, unknown> : {}
  const a: Record<string, unknown> = { ...settings, ...args }
  const models = await comfy.getImageModels()
  if (models.length === 0) return 'Error: no image model is installed.'
  const { resolveModelName } = await import('../vram-handoff')
  const model = typeof a.model === 'string' && a.model ? resolveModelName(a.model, models) : models[0].name
  if (!model) return `Error: no installed image model matches "${String(a.model)}". Installed: ${models.map((m) => m.name).join(', ')}.`
  const listed = models.find((m) => m.name === model)
  const type = listed?.type ?? comfy.classifyModel(model)
  const d = comfy.MODEL_TYPE_DEFAULTS[type] ?? comfy.MODEL_TYPE_DEFAULTS.unknown
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)
  const width = num(a.width, d.width)
  const height = num(a.height, d.height)
  const { buildDynamicWorkflow } = await import('../dynamic-workflow')
  try {
    let workflow = await buildDynamicWorkflow({
      prompt: str(a.prompt, 'a photo'),
      negativePrompt: str(a.negativePrompt, ''),
      model,
      sampler: str(a.sampler, d.sampler),
      scheduler: str(a.scheduler, d.scheduler),
      steps: num(a.steps, d.steps),
      cfgScale: num(a.cfg, d.cfg),
      width,
      height,
      seed: -1,
      batchSize: 1,
      ...(typeof a.lora === 'string' || Array.isArray(a.lora) ? { lora: a.lora as string | string[] } : {}),
      ...(typeof a.loraStrength === 'number' || Array.isArray(a.loraStrength) ? { loraStrength: a.loraStrength as number | number[] } : {}),
      ...(typeof a.vae === 'string' && a.vae ? { vae: a.vae } : {}),
      ...(typeof a.clipSkip === 'number' ? { clipSkip: a.clipSkip } : {}),
      ...(listed?.parts ? { modelParts: listed.parts } : {}),
    }, type)
    if (typeof a.hiresScale === 'number') {
      const { applyNativeHiresFix } = await import('../hires-fix')
      workflow = applyNativeHiresFix(workflow, {
        baseWidth: width, baseHeight: height, scale: a.hiresScale,
        denoise: num(a.hiresDenoise, 0.5), steps: num(a.hiresSteps, 12), upscaleMethod: 'nearest-exact',
      }).workflow
    }
    const { autoDetectParameterMap } = await import('../workflows')
    const { useWorkflowStore } = await import('../../stores/workflowStore')
    const st = useWorkflowStore.getState()
    const id = st.installedWorkflows.find((w) => w.name.toLowerCase() === name.toLowerCase() && w.source === 'manual')?.id ?? uuid()
    st.installWorkflow({
      id, name, description, source: 'manual', modelTypes: [type], mode: 'image',
      workflow, parameterMap: autoDetectParameterMap(workflow), installedAt: Date.now(),
    })
    if (args.assign === true) st.assignToModelName(model, id)
    return `Saved generation preset "${name}" for ${model} [${type}]. It is in the Create tab's workflow list`
      + (args.assign === true ? ' and is now the default for that model.' : '; assign it to the model there to use it by default.')
  } catch (e) {
    return `Error: the preset could not be built: ${errText(e)}`
  }
}

// ── lora_prompt ─────────────────────────────────────────────────

/**
 * Save the prompt (and negative) a LoRA brings along, or import many from a
 * JSON file. `readFile` reads a path inside the agent's workspace (the jailed
 * fs_read), handed in by builtin-tools.
 */
export async function executeLoraPrompt(args: ToolArgs, readFile: (path: string) => Promise<string>): Promise<string> {
  const { useLoraInfoStore } = await import('../../stores/loraInfoStore')
  const { parseLoraPrompts, loraAddition, findLoraPrompt } = await import('../../lib/lora-auto')
  const store = useLoraInfoStore.getState()
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  if (path) {
    let parsed: ReturnType<typeof parseLoraPrompts>
    try {
      parsed = parseLoraPrompts(JSON.parse(await readFile(path)))
    } catch (e) {
      return `Error: could not read ${path} as JSON: ${errText(e)}`
    }
    if (typeof parsed === 'string') return `Error: ${parsed}`
    const n = Object.keys(parsed.prompts).length
    store.mergePrompts(parsed.prompts)
    return `Imported ${n} LoRA prompt(s) from ${path}${parsed.dropped ? `, skipped ${parsed.dropped} incomplete entr${parsed.dropped === 1 ? 'y' : 'ies'}` : ''}. They apply whenever those LoRAs are used.`
  }
  const lora = typeof args.lora === 'string' ? args.lora.trim() : ''
  if (!lora) return 'lora_prompt: `lora` (a LoRA file name) or `path` (a JSON file to import) is required. Nothing was changed.'
  if (args.clear === true) {
    store.setPrompt(lora, null)
    return `Removed the saved prompt of ${lora}.`
  }
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  const negative = typeof args.negative === 'string' ? args.negative.trim() : ''
  if (!prompt && !negative) {
    const add = loraAddition(lora, store.prompts, store.known)
    const neg = findLoraPrompt(lora, store.prompts)?.negative
    return add || neg
      ? `${lora}: prompt "${add}"${neg ? `, negative "${neg}"` : ''}.`
      : `${lora} has no saved prompt and no known trigger words.`
  }
  store.setPrompt(lora, {
    prompt,
    ...(negative ? { negative } : {}),
    ...(args.keepFullPrompt === true ? { keepFullPrompt: true } : {}),
  })
  return `Saved. Every render with ${lora} now starts its prompt with "${prompt ? (args.keepFullPrompt === true ? prompt : prompt.split(/[,;]/)[0].trim()) : '(trigger words)'}"`
    + (negative ? ` and adds "${negative}" to the negative.` : '.')
}
