# Findings

A running log of what came out of reading this codebase. Newest section last.
Status: **open** (nothing done), **PR** (fix proposed), **done**, **idea** (a
proposal, not a defect).

Verified = checked against the code or by running something. Everything else
says what it rests on.

## Status (2026-09-29, master `a51fa836`)

| Section | Status | Closed by |
|---|---|---|
| 1. Russian intent detector | **done** | HateTM/locally-uncensored#8 |
| 2. CSAM gate English-only | **done** for the desktop gate; the server-side cloud gate lives in the web repo and is unchanged | #8 |
| 3. GPU pick never reached the LU Engine | **done** | #3 |
| 8. BM25 quadratic | **done** | #9 |
| 13. Live catalogue (idea) | **done**: live Hugging Face GGUF feed filtered by engine architecture, popular CivitAI list with family / Adult badges | #4, #5 |
| 14. Discover "fits" ignores the KV cache | **done** | #7 |
| 15. Token estimate chars/4 | **done** | #10 |
| 25. B: CivitAI `files[0]` zip | **done** | #5 |
| 25. A: Rapid AIO / lightning defaults (agent path) | **done** | #6 |
| 25. B/C: LoRA family mismatch (badges, no download, triggers skipped at render) | **done** | #5, #6 |

Everything else below is still open, an idea, or a map.

---

## 1. Russian intent detector misroutes ordinary messages (done, #8)

`src/lib/chat-tool-intent.ts`, added in `d684257a` (agent media control).

Probed with the real module:

| Message | Attached photo | Result |
|---|---|---|
| Мне нужно описание картины Моне | no | image |
| хочу купить фотоаппарат | no | image |
| нужна помощь с фотошопом | no | image |
| покажи видео про котов на ютубе | no | video |
| Add up the totals on this receipt | yes | image (edit) |
| Turn this receipt into a table | yes | image (edit) |
| Change of plans: summarize this screenshot | yes | image (edit) |
| Remove duplicates from this list | yes | image (edit) |

Causes:
- `нужн[аоы]` also matches «нужно».
- The stems are matched inside words: `фото` in «фотоаппарат».
- `EDIT_ATTACHED_RE` fires on a leading `add` / `turn` / `change` / `remove` whenever a photo is attached.

Impact: the message goes down the tool route. A generation call is
synthesized only if the model answers empty or with fake "generating…" prose
(`useAgentChat.ts` around line 2035). In that case a receipt photo gets
image-edited instead of summed.

Fix idea: tighten the stems, require an image object for the English edit
verbs, and add regression tests from the table above.

## 2. CSAM prompt gate is English-only (done for the desktop gate, #8)

`src/lib/render/safety.ts`, `checkPromptSafety`.

- `MINOR_ALT` and `SEXUAL_ALT` contain only English terms.
- `d684257a` taught the agent to act on Russian requests, including editing an attached photo.
- A Russian prompt with the forbidden combination is not blocked. This applies to the agent path and to the Create tab (same gate).

Call sites, all of them run the same English-only check:
- `builtin-tools.ts:1885`: agent
- `vram-handoff.ts:1298` and `:1431`: saved LoRA prompts, checked at render time
- `useCreate.ts:569` and `:574`: Create tab
- `useCloudCreate.ts:57`: cloud Create. The authoritative check there is server-side.

Fix idea:
- Add Russian stems to both term lists. Match them without `\b`, because Cyrillic letters are not word characters in JavaScript regexes.
- Add regression tests next to `safety-*.test.ts`.
- There are parity guards against the web copy. They are skipped here because no web checkout exists; check them wherever that checkout lives.

## 3. GPU pick never reached the LU Engine (done, #3)

PR: HateTM/locally-uncensored#3, branch `fix/engine-gpu-selection`. CI is green
on all six jobs.

- The Windows and Linux `lu-llama-server` builds are Vulkan-only (`-DGGML_VULKAN=ON`, `scripts/build-llama.sh`).
- `gpu::apply_gpu_env` sets `CUDA_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES` and `ONEAPI_DEVICE_SELECTOR`. ggml-vulkan reads none of them (checked in `ggml-vulkan.cpp` at the pinned commit). The engine used every discrete GPU.
- `plan_offload` sized `-ngl` against the biggest card:
  - `parse_nvidia_memory` picks the card with the largest total;
  - the `detect_gpus` fallback picks the largest memory.
- With the smaller of two cards picked, this planned a full offload the card could not hold. The start died, and the retry went CPU-only.

Fix:
- New `commands/engine_devices.rs`: `llama-server --list-devices` output is matched to the pick by card name and memory, and passed on as `--device`.
- The layer plan uses the picked devices' free memory.
- Look-alike cards are pinned only when all of them are picked.

Not verified on multi-GPU hardware. Check the Troubleshoot log for:
`the Hardware pick reaches the LU Engine as --device …`

Remaining:
- Changing the pick does not restart an already-running engine (unchanged from before).
- With `auto` on a multi-GPU machine, the plan still uses a single card's reading. This is safe: it errs toward fewer layers.

CHANGELOG entry: the guards need the top CHANGELOG section to be a shipped
release. The proposed text is in the PR description, to add at the next
release.

## 4. llama.cpp pin is ~3 months behind; upstream now has semver releases (idea)

- Pinned: `b9949` / `049326a`, from 2026-07-09. Upstream `b9949` still points at the same commit, so it has not been retagged.
- Since 2026-08-17 upstream publishes curated releases `v0.x.y`. They are bot-tagged on a `bNNNN` commit and their notes include an "API changes" section:

  | Version | Date | Build |
  |---|---|---|
  | v0.4.0 | 2026-09-04 | b10809 |
  | v0.4.1 | 2026-09-14 | b10964 |
  | v0.5.0 | 2026-09-23 | b11146 (`7fe450e`) |

- Latest `b` tag on 2026-09-29: b11255.

Proposal:
- Pin to `v*` releases instead of arbitrary `b` tags.
- Before the jump, check what depends on the tag format:
  - `parsePinnedLlamaTag` (`gguf-arch.ts`, only extracts the value);
  - `build-llama-script.test.ts`;
  - `katalog-architektur.live.test.ts`.
- Before the jump, go through the API changes in v0.1.0–v0.5.0 for everything the app relies on:
  - the `--list-devices` output format;
  - the `/slots` endpoint, `n_prompt_tokens` and `--slot-save-path`;
  - error texts parsed in `engine.rs`;
  - `--host`, which since v0.5.0 accepts several addresses;
  - the architecture list.

Automation idea: a weekly `llama-bump.yml` that watches `v*` tags and opens a
PR with both the tag and the commit, plus the API-changes section.
`sidecar-windows.yml` already rebuilds on any change to `build-llama.sh`.

Two gotchas:
- A PR opened with `GITHUB_TOKEN` does not trigger CI, so this needs a PAT or a GitHub App token.
- The Linux sidecar is built only in `release.yml`. Add a Linux build and a smoke test to the bump PR.

## 5. ComfyUI and custom nodes are unpinned (idea)

- `comfy_install.rs:341` clones `comfyanonymous/ComfyUI` at HEAD. Installing over an existing folder runs `git pull`; repair runs `git pull --ff-only`.
- Custom nodes (`model-bundles.ts`) are also cloned at HEAD and pulled.
- PyTorch comes from the cu130 index for Turing and newer, cu126 below that.

Result: always fresh, not reproducible. An upstream break breaks new installs.
Pinning would look like the llama.cpp pin, but it trades away new-model
support.

## 6. Security finding (kept private until fixed)

Details are held outside the repository while the issue is open.

## 7. Security finding (kept private until fixed)

Details are held outside the repository while the issue is open.

## 8. RAG: BM25 is quadratic and freezes the UI on big documents (done, #9)

`src/api/rag.ts`, `bm25Score` / `hybridSearch`.

`hybridSearch` calls `bm25Score(query, chunk, allDocs)` once per chunk, and each
call does all of the corpus work again:
- it re-splits every document to get `avgDl`;
- it scans every document with `includes(term)` to get the document frequency.

That is O(N² · Q) per message, on the renderer main thread.

Measured with the function copied verbatim, ~500-char chunks, an 8-word query:

| Chunks | ≈ text | Time per message |
|---|---|---|
| 200 | 100 KB | 0.25 s |
| 1000 | 490 KB (~150-page PDF) | 5.9 s |
| 3000 | 1.5 MB | 52 s |

Also:
- `tf` counts exact whitespace tokens, while the document frequency counts substrings. «cat,» never counts as `cat`, but «category» does count for the document frequency.
- The query is split on whitespace only, and stop words («the», «is») are scored like any other term.

Fix idea: compute `avgDl`, the document frequencies and the tokenized documents
once per query (or once at index time), tokenize on `\p{L}\p{N}`, and keep it
off the main thread. The ranking stays the same, and the cost becomes O(N · Q).

## 9. RAG: nomic-embed-text is used without its task prefixes (open)

- The embedding model (`ONBOARDING_EMBED_MODEL`, and the Ollama default) is `nomic-embed-text-v1.5`.
- Its model card requires `search_document: ` on indexed text and `search_query: ` on queries.
- `rag.ts` sends both raw. Nothing in `rag.ts`, `useRAG.ts` or `embed-*.ts` adds a prefix, so vector retrieval runs below the model's intended quality.
- Adding the prefixes changes the vectors. Existing indexes need re-embedding, or a stored version flag with a lazy re-index.

Related:
- nomic v1.5 is an English model. For Russian documents the vector half is weak, and ranking leans on the BM25 half (see 8).
- Retrieval always injects the top 5 chunks, because scores are normalized to the best hit. There is no minimum relevance, so an off-topic question still gets 5 chunks of the document in the prompt.

## 10. Security finding (kept private until fixed)

Details are held outside the repository while the issue is open.

## 11. Security finding (kept private until fixed)

Details are held outside the repository while the issue is open.

## 12. Installers: what is verified (mostly fine, one gap)

- Ollama for Windows and LM Studio: `verify_downloaded_installer` checks size, the Authenticode signature and more. LM Studio's vendor publishes no checksum, and that is documented.
- ComfyUI and custom nodes: `git clone` over HTTPS at HEAD (see 5). No pin.
- cloudflared: one open item, kept private until fixed.

## 13. Model catalogue and "recommended": how it works (map + findings)

### Where the models come from

- **Discover, text** (`api/discover.ts`):
  - two hand-curated static lists: `getUncensoredTextModels()` (abliterated / unfiltered, "the core of LU") and `getMainstreamTextModels()`, about 166 entries in the file;
  - one entry per size variant, sorted by the `released` field;
  - newest entries are from 2026-08; the bulk is from 2026-04;
  - HuggingFace search (`searchHuggingFaceModels`, GGUF filter, sorted by downloads, picks a Q4 file) for anything else;
  - OpenAI-compatible and Anthropic providers list their own models live.
- **Discover, image and video**: bundles in `model-bundles.ts` (model + VAE + encoders + custom nodes). Sorted verified first, then HOT, then "fits VRAM", then size.
- **Onboarding** (`lib/constants.ts`, `ONBOARDING_MODELS`): two models, Qwen 2.5 7B and Qwen 3.5 9B, with measured VRAM (the 6.1 GB is from an RTX 3060), `expectedBytes` and `sha256`.
- The catalogue is compiled into the app. A new model needs an app release.

### How "recommended" / "fits" is decided

- **VRAM source:**
  - `lib/hardware.ts`, `getMaxVramGb()`: the Rust `detect_gpus`, **largest single card**;
  - ComfyUI `/system_stats` as a fallback;
  - Discover takes the larger of the two.
- **Onboarding badge** (`recommendedOnboardingModelName`): the strongest model with `vramGB <= VRAM`. With VRAM unknown, the statically marked one (the 7B) gets it.
- **Discover text tiles** (`ModelTiles.tsx:27`): file size ≤ 85 % of VRAM is `fits`, ≤ 115 % is `tight`, anything above is `big`. The context and KV cache are not counted. The engine's own `plan_offload` does count them, so the two can disagree on long contexts.
- **Discover size filter**: `ultra` ≤ 4 GB, `light` ≤ 10 GB, `middle` ≤ 20 GB, by file size.
- **Chat minimum** (`chat-model-minimum.ts`): anything tagged below 7B is hidden from recommendation groups and never auto-selected. It reads parameter tags, not file sizes.

### Findings

- **Dead, stale recommendation code:**
  - `lib/systemCheck.ts` (`detectSystem` / `getRecommendations`) guesses a tier from the WebGL renderer string and `navigator.deviceMemory`. Only tests import it. Its list is outdated (Qwen 2.5, Llama 3.1 8B), and the heuristic could not work anyway: Chromium caps `deviceMemory` at 8, RTX 50 and RX 7000 cards are missing from the name table, and WKWebView reports "Apple GPU".
  - `lib/model-compatibility.ts`, `getRecommendedAgentModels()`: no caller outside tests and comments. It still names `claude-opus-4-20250514` / `claude-sonnet-4-20250514`; the current Anthropic line is the Claude 5 family.
  - Either delete both or wire them up with fresh data.
- **macOS gets no fit hints:**
  - `detect_gpus` reports no size for Apple silicon (by design, `detect_macos`), and ComfyUI never runs on macOS. So `systemVRAM` stays `null`.
  - Every tile is `unknown`, and onboarding falls back to the static badge.
  - `getTotalRamGb()` is already fetched (the Hardware chip shows it). Unified memory could stand in, e.g. about 70 % of RAM.
- **Multi-GPU:** the hints use the largest single card. This is conservative. The engine, after #3 above, can split across the picked cards.

## 14. How a chat model is chosen and loaded (map + findings)

### Choice (`stores/modelStore.ts`)

- The pick is persisted (`chat-models`).
- On every inventory refresh (`setModels`) it is kept only while it is still in the list and is not a LoRA row.
- Otherwise the first model with a known size of at least 7B is used (`canAutoSelectChat`); if there is none, `null`, i.e. an explicit pick is required.
- An empty inventory, e.g. every provider down, never drops the pick.
- A replacement is announced to the user (`announceChatModelReplaced`).
- The pick is remembered per mode (`lastLocalModel` / `lastCloudModel`) and written onto the open chat.

### Loading, per backend

- **One local model in VRAM at a time.** On a switch, the previous local model is unloaded through its own backend:
  - Ollama: `keep_alive: 0`;
  - LM Studio: its unload API;
  - LU Engine: `stop_bundled_engine`.
  
  The unload is **deferred** until every run still using the old model has ended (`deferLocalUnload`). Compare mode is the documented exception.
- **LU Engine:**
  - It loads **on pick**: `activateBuiltinModel` swaps at once, because llama-server serves one GGUF and ignores the `model` field.
  - **Before every send**, `ensureBuiltinEngineAlive` (`api/builtin-ensure.ts`) checks that the engine is healthy *and* holds that exact file. Otherwise it starts or swaps (`swap_bundled_model`) with the user's tuning.
  - Concurrent calls are coalesced and wait out an in-flight swap.
  - If the engine was switched off in settings, the send fails with a message; it is never restarted behind the user's back.
- **Ollama:**
  - Nothing is preloaded on pick. The model loads on the first request, with `keep_alive: '30m'` (`providers/ollama-provider.ts`).
  - `loadModel` (`keep_alive: '10m'`) is used only to bring a model back after a render (`vram-handoff.ts`).
- **Context per request:**
  - Ollama gets `num_ctx` = min(the model's trained context, cap), where the cap is 16 384 for chat and 32 768 for agent (`lib/context-window.ts`), or the user override.
  - An unknown trained context gets 16 384, never the larger cap (no RoPE extrapolation).
  - LU Engine: 8 192 by default (`effective_ctx`). An agent turn raises it by restarting at min(trained, 32 768) (`ensureBuiltinAgentCtx`); a later swap keeps what the engine already holds (`lib/builtin-ctx.ts`).

### Findings

- **The same model gets a different context depending on the backend:** 8K on the LU Engine, 16K on Ollama for chat, 32K for agent turns on both. A user who moves a model from Ollama to the built-in engine silently gets half the context.
- **Chat ↔ Agent switches cost a reload.**
  - Ollama reloads the model when `num_ctx` changes: 16K becomes 32K.
  - The LU Engine restarts llama-server to raise its context.
  - Alternating between the two modes pays a full model load each way on a big GGUF. Using one context for both, or keeping the larger once it has been reached (the engine side already does the latter), would avoid it.
- **Discover's "fits" ignores the KV cache** (done, #7), while the engine's `plan_offload` adds 4 MiB per layer per 1K tokens. Example: a 12B at 32K is 40 layers × 32 × 4 MiB ≈ 5 GiB of cache on top of the weights.

## 15. Context trimming fires too late for Russian text and tool JSON (done, #10)

### How trimming works

- **Auto-compact** (a model writes a summary) is **opt-in with no default** (`compact-trigger.ts`, owner decision 2026-09-02). Off by default.
- **What always runs** is the mechanical trim (`context-compaction.ts`, `compactMessages`):
  - the last 4 messages (`KEEP_RECENT`) are kept verbatim;
  - older messages become one-liners;
  - tool results are capped;
  - at most 380 messages are sent.
- **The budget** (`send-window.ts`, `chat-send-budget.ts`):
  - budget = 80 % of the model window (`WINDOW_SHARE`);
  - the trim fires at 115 % of the budget (`COMPACT_TRIGGER_RATIO`, hysteresis) and cuts down to 70 % of it;
  - all of this is measured with `estimateTokens` = chars / 4.

### Measured (Qwen 2.5 tokenizer, same samples through both)

| Text | chars/token | chars/4 vs real |
|---|---|---|
| English prose | 4.76 | overestimates by 21 % |
| German prose | 3.44 | underestimates by 12 % |
| TypeScript | 3.70 | underestimates by 4 % |
| JSON tool result | 2.94 | underestimates by 24 % |
| **Russian prose** | **2.84** | **underestimates by 28 %** (real = 1.38 × estimate) |

### What that does

The trim point is 0.8 × 1.15 = 0.92 of the window, as *estimated*. In real
tokens that is:

| Chat | Trim fires at |
|---|---|
| English chat | ≈ 0.76 × window (fine) |
| Russian chat | ≈ **1.27 × window** |
| Agent turns full of JSON results | ≈ 1.21 × window |

So in a Russian chat there is a band, from 100 % to about 127 % of the real
window, where every send is already over the context before the trim does
anything:
- llama-server (LU Engine) rejects the request (context exceeded);
- Ollama truncates the prompt itself, silently, at `num_ctx`.

The margins in `compact-trigger.ts` (up to 12 %) only apply to the opt-in
auto-compact, not to this trim.

### Fix ideas

- A script-aware estimate: count Cyrillic, CJK and JSON-dense text at about 2.8 chars per token, Latin prose at 4.
- Better: calibrate from the backend's own reported `prompt_tokens` for the last turn, which `computeContextFill` already reads for the display, and trim on that.

## 16. Voice mode: English-only local voices, small CPU Whisper (open)

The stack:
- the voice loop is Pipecat (`@pipecat-ai/client-js`). `api/voice-tool-bridge.ts` executes tools on the app side, through the same approval policy and `MUTATING_TOOLS`, with receipts against duplicate calls; that part looks solid;
- local STT: faster-whisper;
- local TTS: Piper;
- cloud: Whisper large-v3-turbo and MiniMax, metered.

Findings:
- **Piper voices offered are English only.** `SpeechSettings.tsx` lists 6 `en_US` / `en_GB` voices, and the default is `en_US-lessac-medium`. A Russian (or German) answer is read by an English voice. Piper publishes `ru_RU` (irina, denis, dmitri, ruslan) and `de_DE` voices. `is_valid_voice` already accepts any such id, so it is a list and a download away.
- **Whisper is fixed to `base` on CPU, int8** (`resources/whisper_server.py:55`):
  - `base` is the weakest usable size and noticeably worse on Russian than `small` or `medium`;
  - the model does not use the GPU even when one is there;
  - language is auto-detected, which is fine, but the size is not configurable.

## 17. A/B Compare: timings measure model loading, errors vanish (open)

`hooks/useABCompare.ts`, `components/chat/ABCompare.tsx`.

- **Two local models run one after the other**, correctly: one engine slot, `runInLane`. With the LU Engine, each round therefore swaps A in, then B in, and the next round swaps A back: two full model loads per round.
- **The speed stats include that load.** `timeMs` runs from before `chatStream`, so it covers the swap and the cold load plus prompt processing, and `tokensPerSec` = chunks / that time. For local pairs the shown t/s mostly measures load time, not generation speed. Measure from the first content chunk (time to first token shown separately), or warm both models before the timer.
- **`tokenCount` counts stream chunks, not tokens.** For Ollama and llama-server one chunk is about one token. Cloud providers batch several tokens per chunk, so mixed pairs are not comparable.
- **Errors are swallowed** (`catch { /* aborted or error */ }` in both streams). A side whose model is missing or whose backend refuses shows an empty answer with normal-looking stats, and no message.

## 18. Sub-agents and background tasks (map + one plausible issue)

### Map

- **`delegate_task`** (`api/agents/sub-agent.ts`):
  - budget per sub-agent: 10 tool calls and 5 iterations by default, configurable;
  - a model may fan out up to 4 in parallel (`SUB_AGENT_MAX_PARALLEL`);
  - an explicit user request ("use 5 glm agents") is detected deterministically (`lib/agent-fanout.ts`) and allowed up to 12;
  - recursion is filtered.
- **Approval** (`lib/agent-approval-policy.ts`): decided once, up front. Sub-agents inherit the run's decision; `blocked` stays blocked, read-only stays read-only. The fan-out tools themselves no longer ask.
- **Engine lane** (`lib/run-slot.ts`): a foreground sub-agent rides the parent's held local lane only with a verified `HeldLocalLane` token; otherwise it books normally. This went through several review rounds and looks sound.
- **Background shell tasks** (`commands/bg_tasks.rs`):
  - a detached child in a registry;
  - a 64 KiB tail of stdout and stderr;
  - reaped under the task lock;
  - swept on shutdown.
  
  The cwd is not jailed, but the shell never is: shell commands rest on the `terminal: confirm` approval.

### Plausible, verify on hardware

Parallel sub-agents share one llama-server context.
- At the pinned llama.cpp (`common/arg.cpp`, `049326a`) the server's `-np` defaults to auto, and `--kv-unified` is "enabled if number of slots is auto". So all concurrent requests share **one** KV cache of `--ctx-size`.
- The app budgets each request as if the whole window were its own (`chatSendBudget`, `compactMessages`).
- Four sub-agents at, say, 6K tokens each on a 16K engine exceed the shared cache together, though each fits alone. Expected symptoms: llama-server evicting the cached prompts of other slots (slow re-processing) or failing a request.
- Fix idea: divide the budget by the number of concurrent local requests, or cap local fan-out to 1–2 on small contexts.

## 19. Security finding (kept private until fixed)

Details are held outside the repository while the issue is open.

## 20. Mobile client double-escapes code blocks (open, confirmed)

`mobile-client/client.js`, `renderMd`.

- `renderMd` escapes the whole text first (`s = H(text)`) and then cuts the code blocks out of the **escaped** string.
- The code is then escaped a second time for display, and the escaped form is stored as the block's source.

Ran the real function on an HTML code block:

- **Shown:** `&amp;lt;div class="a"&amp;gt;x &amp;amp; y…`, so the user sees `&lt;div class="a"&gt;` instead of `<div class="a">`.
- **Copy and Preview source:** `&lt;div class="a"&gt;x &amp; y&lt;/div&gt;`. Copy puts entities on the clipboard. The HTML preview renders escaped text instead of the page, if the button appears at all (`isHtmlSnippet` sees no `<`).

Fix: extract the code blocks from the raw text first, then escape each part once.

## 21. ComfyUI integration against current ComfyUI (checked 2026-09-29)

Compared against a fresh clone of `comfyanonymous/ComfyUI` master: `a716932`,
version **0.37.0**. That is exactly what `install_comfyui` would install today
(see 5).

### Still current

- **HTTP API:** every endpoint the app calls still exists: `/prompt`, `/history`, `/history/{id}`, `/view`, `/object_info`, `/upload/image`, `/queue`, `/interrupt`, `/system_stats`, `/free`, `/models/{folder}`. The deprecation middleware only targets legacy frontend paths (`/scripts/ui`, `/extensions/core/`), not these. New and unused: `/api/jobs`, `/api/jobs/{id}/cancel`.
- **CLI flags:** all of them still exist in `comfy/cli_args.py`: `--listen`, `--port`, `--enable-cors-header`, `--cpu`, `--use-flash-attention`, `--extra-model-paths-config`, `--disable-smart-memory`, `--lowvram`, `--novram`, `--highvram`, `--reserve-vram`.
- **Node classes:** all 55 core classes the graph builders emit exist. The other 11 belong to custom nodes (AnimateDiff-Evolved, GGUF, VHS, RMBG, FramePack, KJNodes, controlnet_aux). `SomeCustomNode` looks like a placeholder.
- **Python:** the app installs 3.12. ComfyUI supports it; it recommends 3.13 ("very well supported") and warns about 3.14.

### Findings

1. **The Create tab never sees ComfyUI's completion event and waits for a 10-second poll.** (open, confirmed in code)
   - `comfyui-ws.ts` declares, and `useCreate.ts:1404` handles, an event `execution_complete` that ComfyUI does not send. The server sends `execution_success` and `execution_interrupted` (`execution.py:824`, `:699`), plus `executing` with `node: null` at the end (`main.py:377`).
   - `useCreate.ts:1383` receives exactly that `node: null` frame, comments "execution finished", and does `break`.
   - Completion is therefore only picked up by the heartbeat that polls `/history` every **10 s** (`useCreate.ts:1296`–`1359`). Every Create render shows its result 0–10 s late, about 5 s on average, and logs "Completion detected via polling (WS event missed)" every time.
   - The agent path (`vram-handoff.ts`) polls every 1 s and is not affected.
   - Fix: treat `executing` with `node: null` or `execution_success` for our `prompt_id` as completion. Treat `execution_interrupted` as a stop.
2. **`SaveAudioMP3` is deprecated** (`is_deprecated=True`, "Save Audio (MP3) (DEPRECATED)"). It is used by local music, ACE-Step (`dynamic-workflow.ts:1964`). It still works; the replacement is `SaveAudioAdvanced` with a format parameter.
3. **Dead wrapper definitions.**
   - `model-bundles.ts` still defines the custom-node packs `cogvideox-wrapper`, `pyramidflow-wrapper` and `allegro`. No bundle uses them, and `dynamic-workflow.ts` answers `strategy: 'unavailable'` for all three architectures.
   - Their repos are stale anyway: PyramidFlowWrapper last pushed 2024-11, Allegro 2025-05 (5 stars), CogVideoXWrapper 2025-08.
   - Active packs are maintained: RMBG, controlnet_aux, AnimateDiff-Evolved and VHS in 2026-07 to 2026-09; GGUF and FramePackWrapper 2026-01.
4. **CogVideoX is now native in ComfyUI core** (`comfy/ldm/cogvideo`, `supported_models.CogVideoX_T2V`, with a text encoder and auto-detection).
   - The app's message says CogVideoX "needs a rebuild against the current wrapper". It no longer needs the wrapper: a standard `UNETLoader` + `CLIPLoader` + `VAELoader` + `KSampler` graph should do.
   - This is an opportunity rather than a bug, and needs a real render to confirm.

## 22. Edit tab: the mask is silently dropped on three paths (open, confirmed in code)

Reported: "the mask does not seem to reach Edit".

### The happy path works

- `MaskCanvasEngine.exportMaskBlob` writes white-where-painted on black: the `LoadImageMask` convention.
- `MaskEditor.apply` uploads it to ComfyUI (`/upload/image`) and stores `mask.filename`.
- `useCreate.ts:976` passes it on as `maskImage` + `growMaskBy`.
- `dynamic-workflow.ts:1111` builds inpainting (`isInpaint`), and `:1271` reads it with `LoadImageMask`, `channel: 'red'`.
- A non-SD model with a mask is refused with a clear message (`:621`), not silently.

### Where it gets lost without a word

1. **A workflow preset is assigned to the model, or to its whole model type.**
   - `useCreate.ts:1048`: `getWorkflowForModel()` returns the preset, and the graph is built by `injectParameters` (`api/workflows.ts`).
   - That function has **no mask handling at all**: `mask` does not occur in `workflows.ts`.
   - The painted mask is ignored and the whole image is repainted. If the preset has no `LoadImage`, even the source image is ignored and it is plain text-to-image.
   - Presets get assigned from the Workflows panel, by `assignToModelType` (a legacy per-type assignment, so it covers *every* SDXL model at once), and by the agent's `workflow_create` with `assign: true`.
   - The only visible hint is the progress line "Using workflow: <name>…".
2. **The dynamic builder throws anything other than `WorkflowUnavailableError`.**
   - `useCreate.ts:1091` falls back to `buildTxt2ImgWorkflow` → `buildSDXLImgWorkflow` (`comfyui.ts:2349`).
   - That builder has `denoise: 1.0` hard-coded and no `inputImage` or mask.
   - The Edit becomes a fresh text-to-image render. The progress line says "Using legacy builder…".
3. **Mask painted while Create was on the cloud backend, then switched to local.**
   - With the cloud backend, `MaskEditor.apply` stores `filename: ''` on purpose (the cloud path uploads from the data URL at submit time).
   - `setBackend('local')` keeps that mask (`createStore.ts:897`; it is dropped only for utility ops).
   - `maskFilename` is then `''`, and the `...(maskFilename ? {…} : {})` at `useCreate.ts:976` drops it. The canvas still shows the mask.

### Fix ideas

- Refuse to run a masked Edit through a preset or the legacy builder unless it can carry the mask: throw `WorkflowUnavailableError` with a message the way `dynamic-workflow.ts:621` does. Or teach `injectParameters` a `maskImage` mapping for `LoadImageMask` / `VAEEncodeForInpaint`.
- On `setBackend('local')`, upload a mask (and source) whose `filename` is `''` from its data URL, or clear it visibly.
- A regression test per path: preset assigned, legacy fallback, cloud→local.

## 23. Every Create mode against ComfyUI 0.37 and its official templates

Reference:
- ComfyUI master `a716932` (0.37.0);
- the official `Comfy-Org/workflow_templates` at `dd9769b`, both 2026-09-29: 374 local templates, `api_*` cloud ones excluded.

The app's graphs come from `api/dynamic-workflow.ts` and `api/component-registry.ts`.

**Nothing here was rendered.** Every item comes from reading the app's graph
against ComfyUI's code and the official template. Items marked **likely broken**
should fail validation or produce garbage by that reading; each needs one real
render to confirm.

### Per mode

| Mode / family | App graph | Official / core | Verdict |
|---|---|---|---|
| Text→image SD 1.5 / SDXL | CheckpointLoaderSimple + KSampler | same | ok |
| Z-Image | CLIPLoader `qwen_image` | CLIPLoader `lumina2` | ok: for a Qwen3-4B file both types route to `z_image.te` (`sd.py`, `QWEN3_4B` branch) |
| Qwen-Image 2.1, Krea 2, ERNIE, Flux 2 / Klein | CLIP types `qwen_image` / `krea2` / `flux2` | same | ok |
| Edit / inpaint (SD) | `InpaintModelConditioning` if present, else `VAEEncodeForInpaint` | Flux-Fill template: `InpaintModelConditioning` + `DifferentialDiffusion` | ok (mask loss on other paths: see 22) |
| Remove background | custom node **RMBG** (1038lab) | **core now has** `LoadBackgroundRemovalModel` + `RemoveBackground` (BiRefNet), template `utility_birefnet_remove_background` | improvement: drop the custom-node dependency |
| Video save | `VHS_VideoCombine` (custom) → `SaveAnimatedWEBP` → PNG frames | every template: core `CreateVideo` + `SaveVideo` (mp4, with audio) | improvement: without VHS, users get WEBP or frames although core can write mp4 |
| **HunyuanVideo 1.5** (catalogue bundle, `verified: true`) | CLIPLoader(`qwen_2.5_vl`, type `wan`) + **`EmptyHunyuanLatentVideo`** + `HunyuanImageToVideo`; bundle ships CLIP-L | `DualCLIPLoader`(qwen_2.5_vl + **byT5**, `hunyuan_video_15`) + **`EmptyHunyuanVideo15Latent`** + `HunyuanVideo15ImageToVideo`, `ModelSamplingSD3`, optional SR stage | **likely broken**: v1 latent is 16 ch at /8, v1.5 needs 32 ch at /16 (`nodes_hunyuan.py`). Type `wan` on Qwen2.5-VL falls to `qwen_image.te`, the wrong encoder |
| **LTX 2.3** (catalogue bundle, `verified: true`) | file placed in `diffusion_models` → UNETLoader + CLIPLoader(gemma, `ltxv`) + `EmptyLTXVLatentVideo`; `VAEDecode.vae` wired to `[unetId, 0]` | file is a full checkpoint → `CheckpointLoaderSimple` + `LTXAVTextEncoderLoader`(gemma, ckpt) + audio chain (`LTXVEmptyLatentAudio`, `LTXVConcatAVLatent`, `LTXVAudioVAEDecode`) | **likely broken**: UNETLoader has no VAE output, so `VAEDecode` gets a MODEL (`dynamic-workflow.ts` ~850: "fallback reference (won't be used for LTX)", yet `:1444` uses it). The text projection from the checkpoint is never loaded |
| **Wan 2.2 A14B** (user-downloaded, official names `wan2.2_t2v_high_noise_14B_*`) | `classifyModel` → `wan22` → TI2V-5B graph with `wan2.2_vae` (48 ch) | two experts (high + low noise), `KSamplerAdvanced` hand-off, `wan_2.1_vae` (16 ch) | **likely broken** for any A14B file; only TI2V-5B, S2V, Animate and "rapid AIO" merges are wired. A14B is the flagship of the official templates |
| **ACE-Step 1.5** music | CheckpointLoaderSimple + **`ModelSamplingSD3` shift 5** | `ModelSamplingAuraFlow` shift 3, 8 steps, cfg 1 (turbo) | **likely wrong output**: `supported_models.ACEStep15` has `multiplier: 1.0`. `ModelSamplingSD3` patches `multiplier=1000`; `ModelSamplingAuraFlow` keeps 1.0. ACE-Step 1.0 (SD3, shift 5) matches its template and is fine |
| ACE-Step 1.5 XL / split | not supported (checkpoint only) | UNETLoader + `DualCLIPLoader` `ace` + VAELoader | gap |
| Music output | `SaveAudioMP3` | `SaveAudioAdvanced` | deprecated node (see 21) |
| CogVideoX | disabled ("needs wrapper rebuild") | native in core | opportunity (see 21) |
| Upscale | cloud only | core `ImageUpscaleWithModel` + several `utility_*upscale*` templates | opportunity: a local upscale lane |

### Suggested order

1. **HunyuanVideo 1.5, LTX 2.3, ACE-Step 1.5:** catalogue items marked verified that should not work as built. Confirm each with one render, then rebuild the graph from its template.
2. **Wan 2.2 A14B:** at least stop misrouting it to TI2V-5B (refuse with a clear message), then wire the two-expert graph.
3. **Core `SaveVideo` and `RemoveBackground`:** drop two custom-node dependencies (VHS, RMBG).
4. `SaveAudioAdvanced`; CogVideoX native; local upscale.

## 24. What ComfyUI can do that the app does not offer (gap list, 2026-09-29)

Sources:
- `comfy/supported_models.py` (≈100 model classes) and `comfy/ldm/`;
- core nodes in `comfy_extras/` and `nodes.py`;
- 374 local official templates.

Partner-API templates (Topaz, Bria, Recraft, HitPaw, NanoBanana) are left
out: they are not local.

"Core" = native in ComfyUI 0.37, no custom node needed.

### What the app has today, for reference

- **Local:** text→image, Edit (img2img and mask inpaint on SD / SDXL), background removal (via RMBG), text→video, image→video, extend, music (ACE-Step), lip-sync (Wan S2V), motion (Wan Animate), character LoRA training (musubi, outside ComfyUI).
- **Cloud only:** upscale, eraser.

### Tools on existing images and video (core, high value, small graphs)

| Capability | Core nodes / template |
|---|---|
| Local **image upscale** (GAN / ESRGAN models) | `UpscaleModelLoader` + `ImageUpscaleWithModel`; `utility-gan_upscaler` |
| **SeedVR2** image and video upscale | core `seedvr` model, `utility_seedvr2_*` |
| **SUPIR** restoration upscale | core `supir`, `utility_image_upscale_supir` |
| **Video frame interpolation** (smoother / slow-mo) | core FILM nodes; `utility_video_frame_interpolation` |
| **SAM 3 segmentation by text** ("select the car") | core SAM3 nodes; `utility_image_segment_sam3`, `utility_video_segment_sam3`. Would give the Edit tab automatic masks |
| **Outpainting** (extend the canvas) | `ImagePadForOutpaint` + inpaint |
| **Depth / geometry** | Depth Anything 3, MoGe; `utility_depth_anything3_*`, `utility_moge_*` |
| **Pose** (SDPose), a core replacement for the `DWPreprocessor` custom node Motion uses | `utility_sdpose_*` |
| **Video object removal / inpaint** (VOID) | `utility_void_video_inpainting` |

### Control and consistency

| Capability | Core nodes / template |
|---|---|
| **ControlNet** (pose / depth / canny, union models). The app only lists the `controlnet` folder | `ControlNetLoader` + `ControlNetApplyAdvanced`; Z-Image / Qwen ControlNet templates |
| **Wan first-last-frame → video** | `WanFirstLastFrameToVideo`; `video_ltx2_3_flf2v` for LTX |
| **Wan camera control** | `WanCameraImageToVideo` |
| **Wan Fun Control / VACE / HuMo** (driving video, reference subject, human-centric audio) | core `WAN21_FunControl2V`, `WAN21_Vace`, `WAN21_HuMo`; `WanVace` exists in the app's types but no lane |
| **Instruction image editing beyond Qwen-Image** | Omnigen2, JoyImage Edit, LongCat Image Edit, Flux 2 Klein edit |
| **LoRA training inside ComfyUI** | core `TrainLoraNode` (`nodes_train.py`). The app uses musubi separately; an alternative for SD / SDXL / Flux families that musubi does not cover here |

### Model families not wired at all

- **Image:** HunyuanImage 2.1 (+ refiner), Kandinsky 5 Image, Ideogram 4, Boogu, Mage-Flow, LongCat Image, Omnigen2, JoyImage, HiDream-O1, PixArt α/Σ, AuraFlow, Stable Cascade, SenseNova U1.5, PixelDiT, Lens, Anima.
- **Video:** Wan 2.2 A14B T2V / I2V (see 23), Kandinsky 5 video, CogVideoX (native now, see 21), Cosmos Predict 2, HunyuanVideo 1.5 SR stage, SkyReels I2V, Wan dancer / SCAIL / FlowRVS variants.
- **Audio:**
  - Stable Audio (and Stable Audio 3 medium), core;
  - **YuE 2** (full songs with vocals and cover mode), core;
  - MiniMax Music 3, core model;
  - ACE-Step 1.5 XL / split (see 23);
  - audio separation (MelBand, template only, custom node);
  - Chatterbox TTS / voice conversion (templates, custom node). Could also feed the app's voice mode, which today offers only English Piper voices (see 16).
- **3D** (whole category absent): Hunyuan3D 2 / 2.1 / mini (image or multiview → mesh), Trellis 2, TripoSplat (gaussian splats), SV3D / Zero123, SAM 3D Body, MoGe panorama → mesh.
- **Text generation inside ComfyUI** (`nodes_textgen.py`, `llm_*` templates, e.g. `TextGenerateLTX2Prompt` for prompt enhancement). The app already has its own LLM stack, so this matters only as a prompt enhancer inside render graphs.

### Suggested priorities for a local, uncensored studio

1. **Local upscale** (GAN, then SeedVR2): today it is cloud-only, and the graph is tiny.
2. **SAM 3 masks for Edit**: "select by text" instead of hand painting. Pairs with the mask fix (22).
3. **ControlNet (pose / depth)** for image, and **first-last-frame** for video: the most asked-for control features in local pipelines.
4. **Frame interpolation** for smoother short clips from the 16–24 fps models.
5. **YuE 2 / Stable Audio** next to ACE-Step; Chatterbox for multilingual TTS.
6. 3D as a separate, later area.

## 25. Uncensored models, NSFW LoRA search/download, auto prompts (checked 2026-09-29)

Scope: whether adult generation works as the app advertises it. The CSAM
gate (see 2) is out of scope here and stays as it is.

### A. Uncensored models in the catalogue

- **Text** (`getUncensoredTextModels`, 74 entries with a HuggingFace URL). A HEAD request on every link: **72 answer 200, 2 answer 401**, both *DeepSeek V4 Flash Abliterated* (`huihui-ai/Huihui-DeepSeek-V4-Flash-abliterated-GGUF`, IQ1 and Q3). The repo is gated or gone. Remove the two entries or re-point them.
- **Image**:
  - Juggernaut XL, RealVisXL, DreamShaper XL: plain SDXL checkpoints; path OK.
  - Z-Image Turbo / Base "Unfiltered": path OK (see 23).
- **Video, explicitly NSFW** (both links answer 200; both need the `ComfyUI-GGUF` custom node, which the bundle declares):
  - *NSFW Wan 14B (GGUF)* `nsfw_wan_14b_e15_q4_k.gguf` → classified `wan` → Wan 2.1 graph with `wan_2.1_vae`. Matches its architecture.
  - *Wan 2.2 Rapid AIO (Uncensored I2V, GGUF)* → classified `wan` (the `rapid` + `aio` rule), `WanImageToVideo` + `wan_2.1_vae`. Architecture OK, but **sampler defaults were wrong on the agent path** (done, #6). Correction: the Create tab already applied a rapid / lightning rule (6 steps, cfg 1) in `createStore.setVideoModel`; only the agent's video paths used the architecture defaults below:
    - the bundle itself says "lightning merged for few step renders";
    - yet it gets the generic `MODEL_TYPE_DEFAULTS.wan`: **30 steps, cfg 6.0** (`comfyui.ts`);
    - a lightning merge wants cfg 1 and about 4 steps. At cfg 6 the output burns (oversaturated, artefacts), and 30 steps is about 7× the needed time;
    - nothing in the code special-cases it (searched `rapid` for cfg / steps / sampler).
    
    Fix: per-bundle defaults, or a `rapid` / `aio` / `lightning` rule in the defaults.

### B. NSFW LoRA search and download (CivitAI)

What works:
- Search (`searchCivitaiModels`) sends `nsfw=true` and the user's API key as a header.
- Downloads carry the key (`civitaiAuthToken`, fixed after a 2026-08-28 report).
- The recipe reader asks with `nsfw=X`.

**Found, confirmed on the live API** (`/api/v1/models?types=LORA&sort=Most Downloaded&nsfw=true`, top 100):
- (done, #5) **`files[0]` is not the LoRA for 3 of the top 100.** `civitaiItemToResult` takes `downloadUrl` from the *version* (which serves the **primary** file) but `filename` and `sizeKB` from `files[0]`. For three top LoRAs `files[0]` is `…workflow.zip` / `Images.zip` ("Training Data" / "Other"). Two of the three are NSFW Wan 2.2 LoRAs. The `.safetensors` is saved into `models/loras` under a `.zip` name, so ComfyUI never lists it as a LoRA, and `lora_download` still reports success. Fix: pick `files.find(f => f.primary) ?? files.find(f => f.type === 'Model')`.
- (done, #5 / #6: family badges and no download for families LU cannot run; mismatched LoRAs contribute no prompt words at render, and the mismatch is named. The search itself still does not pass `baseModels`.) **No base-model filter.** The search does not pass `baseModels`, and nothing checks the LoRA's `baseModel` (stored by `rememberLoraHit`) against the chosen model at render time. The top 100 mix Pony, Illustrious, NoobAI, SD 1.5, SDXL, Flux, Krea 2, Qwen 2.1, Wan 14B i2v 480p and Wan 2.2 I2V-A14B. A mismatched LoRA loads with ComfyUI's "lora key not loaded" warnings and **no effect**, while its trigger words are still put in front of the prompt. The agent tool only asks the model to "PREFER a LoRA whose base model matches".
- **Most NSFW video LoRAs target Wan 2.2 A14B, as high / low noise pairs.** The app has no A14B graph (see 23), downloads only the primary file of a pair, and applies Wan 2.2 LoRAs to the TI2V-5B model, where A14B weights do not fit.

### C. Automatic positive and negative prompts

What exists:
- **LoRA prompts** (`lib/lora-auto.ts`): the user's saved prompt for the LoRA (its first clause, or all of it with `keepFullPrompt`), else up to 3 CivitAI trigger words, put in front of the prompt. A saved LoRA negative is appended to the negative. Both run on the Create tab and on the agent path, both through the CSAM gate at render.
- **Wan default negative** (`WAN_DEFAULT_NEGATIVE`): the official Chinese quality negative, used when none is given. It has no NSFW-suppressing terms. Good.
- No default negative anywhere contains `nsfw` / `nude`. Good: nothing silently suppresses adult output.

Gaps:
- **No family-specific quality tags locally.**
  - Pony, Illustrious and NoobAI are classified plain `sdxl` (`comfyui.ts:218`–`220`).
  - The `score_9, score_8_up…` hint exists only as a *cloud* preset tip (`render/preset-models.ts:183`).
  - Locally there are no quality tags, no family negative (e.g. `score_4, score_5` for Pony; `worst quality, low quality` for Illustrious), and no clip-skip-2 default these finetunes are usually run with.
- **Trigger dedup ignores non-Latin text.** `normalizeForMatch` keeps `[a-z0-9]` only, so a Russian or other non-Latin prompt that already contains a trigger phrase gets it added a second time. Minor.
- **Trigger words go in even when the LoRA does not fit the model** (see B).

### Suggested order

1. ~~CivitAI primary-file pick~~ (done, #5).
2. ~~Rapid AIO defaults~~ (done, #6).
3. ~~Base-model check at render~~ (done, #6). Still open: pass `baseModels` in search when the family is known.
4. Local Pony / Illustrious presets: quality tags, negative, clip skip.
5. Drop or fix the two 401 text entries.

## Minor

- `media-tools.ts`, `executeLoraDownload`: a throw from `getDownloadProgress()` inside the poll loop fails the whole tool call instead of returning a readable error.
- `media-tools.ts`, `civitaiRecipe`: a LoRA name with no letters or digits gives an empty stem, and `includes('')` then reports it as installed.
- Not a finding, context: CI annotations say `actions/checkout` and `actions/setup-node` at the pinned SHAs target Node 20, which runners now force onto Node 24. They need bumping eventually.

## Checked and fine

- All 18 built-in agent tools are wired to an executor. The mutating ones (`lora_download`, `lora_prompt`, `workflow_create`, …) are in `MUTATING_TOOLS`, so they need approval.
- `lora_prompt` JSON import goes through the jailed `fs_read`.
- `lora_download` waiting honours the abort signal.
- Baseline on `master` (`d684257a`): typecheck, eslint (0 errors, 0 warnings), madge (no cycles) and vitest (12 418 passed) are all green.
