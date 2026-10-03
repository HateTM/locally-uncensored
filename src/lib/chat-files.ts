/**
 * Any file as a chat attachment (3.0.5, applejames on Discord: "let me give
 * the model a ROM file").
 *
 * WHAT A MODEL CAN DO WITH A BINARY. Nothing with the bytes themselves: a
 * language model reads text, and base64 pasted into the prompt is neither
 * readable to it nor affordable (a 16 MB ROM is about 21 million characters).
 * So the chat does two honest things instead:
 *
 *   1. Every chat gets a compact description in place of the bytes: name,
 *      size, the type read from the magic bytes, the SHA-256, a hex dump of
 *      the first bytes and the readable strings found inside. All of it in a
 *      fixed budget, a few kilobytes per file whatever the file weighs.
 *   2. In Agent and Code the file is also copied into the chat's working
 *      folder, where the file and shell tools can work on the real thing.
 *
 * WHAT IS STORED. Only the description. The file is not copied into the chat
 * history, not as base64 and not as a reference to a stored blob: the history
 * is serialised as one string on every save, and a few large images in it
 * have taken the renderer down before (chat-attachments.ts, the 127 MiB
 * IndexedDB limit). The description is bounded by the constants below.
 *
 * The same text goes out to a local model and to a cloud model: it is part of
 * the user message, so no provider needs to know about it.
 */
import { backendCall } from '../api/backend'
import type { FileAttachment } from '../types/chat'
import { detectFileKind } from './file-magic'
import { formatBytes } from './formatters'
import { log } from './logger'

/** How many files one message may carry. */
export const MAX_CHAT_FILES = 3
/** The largest file that can be attached. The whole file is read once to hash
 *  it, so this is also the most memory an attachment costs for a moment. */
export const MAX_CHAT_FILE_BYTES = 64 * 1024 * 1024
/** How much of the start of a binary is shown as a hex dump. */
export const HEX_DUMP_BYTES = 256
/** The budget for readable strings, in characters. */
export const STRINGS_BUDGET_CHARS = 3000
/** How much of a text file is shown. */
export const TEXT_EXCERPT_CHARS = 4000
/** A run of printable characters counts as a string from this length on. */
const MIN_STRING_LENGTH = 5
/** One string never takes more of the budget than this. */
const MAX_STRING_LENGTH = 120
/** How far into the file the string scan reads at most. */
const STRINGS_SCAN_BYTES = 8 * 1024 * 1024
/** The window the type detection looks at. The ISO 9660 signature sits at
 *  0x8001, everything else far earlier. */
const KIND_WINDOW_BYTES = 64 * 1024
/** Raw bytes per call when a file is copied into the working folder. */
const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024

export const TOO_MANY_FILES_MESSAGE = `You can attach up to ${MAX_CHAT_FILES} files per message.`

export function fileTooLargeMessage(name: string): string {
  return `"${cleanFileName(name)}" is too large. You can attach files up to ${formatBytes(MAX_CHAT_FILE_BYTES)}.`
}

/** A file waiting in the composer, or on its way through a send. `file` is the
 *  handle to the bytes; it is absent on a resend, where the stored
 *  description is all that is left and all that is needed. */
export interface ChatFileInput {
  attachment: FileAttachment
  file?: File
}

/**
 * A file name as one harmless line: no path, no control characters, no line
 * break that could end the attachment block early, and not endless.
 */
export function cleanFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? ''
  const base = Array.from(last, (c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? ' ' : c))
    .join('')
    .replace(/[[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  if (!base) return 'file'
  return base.length > 120 ? `${base.slice(0, 117)}...` : base
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

/** The classic sixteen-per-line dump: offset, hex bytes, printable column. */
export function hexDump(bytes: Uint8Array, limit = HEX_DUMP_BYTES): string {
  const end = Math.min(bytes.length, limit)
  const lines: string[] = []
  for (let at = 0; at < end; at += 16) {
    const row = bytes.subarray(at, Math.min(at + 16, end))
    const hex = Array.from(row, hex2)
    while (hex.length < 16) hex.push('  ')
    const shown = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${at.toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${shown}|`)
  }
  return lines.join('\n')
}

/**
 * The readable strings in a binary, in file order, each one once, until the
 * budget is spent. `more` says whether the scan stopped before the end of the
 * file, so the description never claims to be complete when it is not.
 */
export function readableStrings(bytes: Uint8Array, budgetChars = STRINGS_BUDGET_CHARS): { strings: string[]; more: boolean } {
  const strings: string[] = []
  const seen = new Set<string>()
  let used = 0
  const end = Math.min(bytes.length, STRINGS_SCAN_BYTES)
  let start = -1
  for (let i = 0; i <= end; i++) {
    const printable = i < end && bytes[i] >= 0x20 && bytes[i] < 0x7f
    if (printable) {
      if (start < 0) start = i
      continue
    }
    if (start >= 0 && i - start >= MIN_STRING_LENGTH) {
      const length = Math.min(i - start, MAX_STRING_LENGTH)
      let value = ''
      for (let j = start; j < start + length; j++) value += String.fromCharCode(bytes[j])
      value = value.trim()
      if (value.length >= MIN_STRING_LENGTH && !seen.has(value)) {
        if (used + value.length + 1 > budgetChars) return { strings, more: true }
        seen.add(value)
        strings.push(value)
        used += value.length + 1
      }
    }
    start = -1
  }
  return { strings, more: end < bytes.length }
}

/** What the model reads in place of the bytes. Pure, so it can be tested on a
 *  handful of bytes. */
export function describeFileBytes(bytes: Uint8Array, name: string): { kind: string; summary: string } {
  const kind = detectFileKind(bytes.subarray(0, KIND_WINDOW_BYTES), name)
  if (bytes.length === 0) return { kind: 'Empty file', summary: 'The file is empty.' }
  if (kind.isText) {
    // The window may end inside a multi-byte character; a lenient decoder
    // turns that into one replacement character, which is cut off below.
    const window = bytes.subarray(0, TEXT_EXCERPT_CHARS * 4)
    const decoded = new TextDecoder('utf-8').decode(window).replace(/�+$/, '')
    const excerpt = decoded.slice(0, TEXT_EXCERPT_CHARS)
    const whole = window.length === bytes.length && excerpt.length === decoded.length
    return {
      kind: kind.label,
      summary: whole
        ? `The whole text of the file:\n${excerpt}`
        : `The file is longer than this excerpt. The first ${excerpt.length} characters:\n${excerpt}`,
    }
  }
  const shown = Math.min(bytes.length, HEX_DUMP_BYTES)
  const { strings, more } = readableStrings(bytes)
  const parts = [
    'This is a binary file. Its bytes cannot be shown to you, so this is a summary of it.',
    `Hex dump of the first ${shown} bytes:\n${hexDump(bytes)}`,
  ]
  if (strings.length > 0) {
    parts.push(
      `Readable strings found in the file${more ? ' (the first ones, there are more)' : ''}:\n${strings.join('\n')}`,
    )
  } else {
    parts.push('No readable strings were found in the file.')
  }
  return { kind: kind.label, summary: parts.join('\n\n') }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash), hex2).join('')
}

/**
 * Read a picked file once and build its description. Refuses a file over the
 * limit before reading a byte of it.
 */
export async function prepareChatFile(file: File): Promise<ChatFileInput> {
  if (file.size > MAX_CHAT_FILE_BYTES) throw new Error(fileTooLargeMessage(file.name))
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new Error(`"${cleanFileName(file.name)}" could not be read.`)
  }
  const name = cleanFileName(file.name)
  const { kind, summary } = describeFileBytes(new Uint8Array(buffer), name)
  return {
    attachment: { name, size: buffer.byteLength, kind, sha256: await sha256Hex(buffer), summary },
    file,
  }
}

/** The block one file contributes to the user message. */
export function fileBlock(file: FileAttachment, surface: 'chat' | 'workspace'): string {
  const where = file.workspacePath
    ? `Path in your working folder: ${file.workspacePath}\nUse your file and shell tools on that path for anything this summary does not answer.`
    : surface === 'workspace'
      ? 'The file could not be copied into your working folder. Only this summary is available.'
      : 'The file itself is not available to you in this chat. Only this summary is.'
  return [
    `[Attached file: ${file.name}]`,
    `Type: ${file.kind}`,
    `Size: ${formatBytes(file.size)} (${file.size} bytes)`,
    `SHA-256: ${file.sha256}`,
    where,
    '',
    file.summary,
    `[End of attached file: ${file.name}]`,
  ].join('\n')
}

/** What the user typed when a message carries nothing but files. */
export const FILE_ONLY_TEXT = '(file)'

/**
 * The user message as the model receives it: what was typed, then one block
 * per file. Without files the text comes back untouched.
 */
export function composeFileMessage(typed: string, files: readonly FileAttachment[] | undefined, surface: 'chat' | 'workspace' = 'chat'): string {
  if (!files?.length) return typed
  return [typed, ...files.map((file) => fileBlock(file, surface))].join('\n\n')
}

/**
 * The three fields a user message gets from its files: `content` is what the
 * model reads (typed text plus one block per file), `displayContent` is what
 * the user typed and what the bubble shows, `files` draws the chips and lets a
 * resend rebuild the message. Without files only `content` comes back, so a
 * message without attachments is stored exactly as before.
 */
export function fileMessageFields(
  typed: string,
  files: readonly FileAttachment[] | undefined,
  surface: 'chat' | 'workspace' = 'chat',
): { content: string; displayContent?: string; files?: FileAttachment[] } {
  if (!files?.length) return { content: typed }
  return { content: composeFileMessage(typed, files, surface), displayContent: typed, files: [...files] }
}

/**
 * The attachments of a send that has no working folder (plain chat, a group
 * round, Chat Tools). A path from an earlier Agent turn is dropped: this
 * surface has no tool that could open it, and the block must not say it has.
 */
export function filesWithoutWorkspace(inputs: readonly ChatFileInput[] | undefined): FileAttachment[] | undefined {
  if (!inputs?.length) return undefined
  return inputs.map(({ attachment }) => {
    const { workspacePath: _dropped, ...rest } = attachment
    return rest
  })
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

/** `rom.gba` taken: `rom (1).gba`, `rom (2).gba`, and so on. */
export function numberedFileName(name: string, n: number): string {
  if (n === 0) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
}

/** Where the working folder of a run is, in the words the fs commands take. */
export interface ChatFileWorkspace {
  chatId: string
  workingDirectory?: string
}

const TAKEN = /already exists/i

async function uploadFile(file: File, workspace: ChatFileWorkspace): Promise<string> {
  const name = cleanFileName(file.name)
  for (let n = 0; n < 50; n++) {
    const path = numberedFileName(name, n)
    try {
      let offset = 0
      do {
        const chunk = new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer())
        const last = offset + chunk.length >= file.size
        await backendCall('fs_write_bytes', { path, base64: toBase64(chunk), offset, last, ...workspace })
        offset += chunk.length
      } while (offset < file.size)
      return path
    } catch (err) {
      // The folder may be the user's real project. A name that is taken there
      // is never overwritten; the attachment gets the next free one.
      if (TAKEN.test(err instanceof Error ? err.message : String(err))) continue
      throw err
    }
  }
  throw new Error('No free file name in the working folder.')
}

/**
 * Copy the attached files into the working folder of an Agent or Code run.
 *
 * Never throws and never blocks the send: a file that cannot be copied (disk
 * full, a browser session without a backend, a resend of a message whose
 * bytes are long gone) keeps its description, and the block the model reads
 * says that only the summary is available. `failed` names those files so the
 * caller can tell the user.
 */
export async function placeChatFiles(
  inputs: readonly ChatFileInput[],
  workspace: ChatFileWorkspace,
): Promise<{ files: FileAttachment[]; failed: string[] }> {
  const files: FileAttachment[] = []
  const failed: string[] = []
  for (const { attachment, file } of inputs) {
    // Already in the folder: a resend, or the same message sent again.
    if (attachment.workspacePath || !file) {
      files.push(attachment)
      continue
    }
    try {
      files.push({ ...attachment, workspacePath: await uploadFile(file, workspace) })
    } catch (err) {
      log.warn('[chat-files] the attachment could not be copied into the working folder', { err: String(err) })
      failed.push(attachment.name)
      files.push(attachment)
    }
  }
  return { files, failed }
}

export function copyFailedMessage(names: readonly string[]): string {
  const list = names.map((name) => `"${name}"`).join(', ')
  return `${list} could not be copied into the working folder. The model only gets a summary of it.`
}
