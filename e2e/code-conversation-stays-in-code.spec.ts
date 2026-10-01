import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { openNewChat } from './support/ui'

/**
 * Gegenprobe on the real Windows build, 30.09.2026, two findings:
 *
 * 1. With a Code run in flight, Chat and then Code in the rail landed on the
 *    empty Code start page. The running conversation had to be found in the
 *    list.
 * 2. After a restart the last Code conversation opened in the CHAT tab, with
 *    Agent off. The customer's "continue" typed there went out without tools.
 *
 * The app still starts in the Chat tab (codexStore, product decision); it now
 * starts on the empty chat instead of a Code conversation in disguise, and the
 * Code button returns to the Code conversation worked on last.
 */

const MARKE = 'Zeile aus dem Code-Verlauf, die nur im Code-Reiter stehen darf'

async function bootCode(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await openNewChat(page)
}

/** A Code conversation with one exchange, written the way the store writes it, then flushed to disk. */
async function codeVerlauf(page: Page): Promise<void> {
  await page.evaluate(async (marke) => {
    const chatPath = '/src/stores/chatStore.ts'
    const chat = await import(/* @vite-ignore */ chatPath) as typeof import('../src/stores/chatStore')
    const aktiv = chat.useChatStore.getState().activeConversationId
    if (!aktiv) throw new Error('no active Code conversation')
    const conv = chat.useChatStore.getState().conversations.find((c) => c.id === aktiv)
    if (conv?.mode !== 'codex') throw new Error(`active conversation is ${conv?.mode}, not codex`)
    chat.useChatStore.getState().addMessage(aktiv, { id: 'u1', role: 'user', content: 'build the page', timestamp: Date.now() })
    chat.useChatStore.getState().addMessage(aktiv, { id: 'a1', role: 'assistant', content: marke, timestamp: Date.now() + 1 })
    await chat.flushChatPersist()
  }, MARKE)
}

test('the Code button goes back to the Code conversation, not to an empty start page', async ({ page }) => {
  await bootCode(page)
  await codeVerlauf(page)
  await expect(page.getByTestId('codex-transcript').getByText(MARKE)).toBeVisible()

  // The rail's Chat button, not the Chat tab in the top bar.
  await page.locator('button[title="Chat"][aria-label="Chat"]').first().click()
  await expect(page.getByText(MARKE)).toHaveCount(0)

  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await expect(page.getByTestId('codex-transcript').getByText(MARKE)).toBeVisible()
})

test('after a restart a Code conversation is not shown as a chat', async ({ page }) => {
  await bootCode(page)
  await codeVerlauf(page)
  await expect(page.getByTestId('codex-transcript').getByText(MARKE)).toBeVisible()

  await page.reload()
  // The app starts in the Chat tab, on the chat worked on last; there is none
  // here, so on the empty chat.
  await expect(page.locator('textarea').first()).toBeVisible()
  await expect(page.getByTestId('codex-transcript')).toHaveCount(0)
  await expect(page.getByText(MARKE)).toHaveCount(0)

  // One click and the Code conversation is back, in the Code tab.
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await expect(page.getByTestId('codex-transcript').getByText(MARKE)).toBeVisible()
})

const CHAT_MARKE = 'Zeile aus dem Chat, zu der der Chat-Knopf zurueckfuehrt'

/** A plain chat with one exchange, worked on before the Code conversation. */
async function chatVerlauf(page: Page): Promise<void> {
  await page.evaluate(async (marke) => {
    const chatPath = '/src/stores/chatStore.ts'
    const chat = await import(/* @vite-ignore */ chatPath) as typeof import('../src/stores/chatStore')
    const id = chat.useChatStore.getState().createConversation('m', '', 'lu')
    chat.useChatStore.getState().addMessage(id, { id: 'cu1', role: 'user', content: 'hello', timestamp: Date.now() })
    chat.useChatStore.getState().addMessage(id, { id: 'ca1', role: 'assistant', content: marke, timestamp: Date.now() + 1 })
    await chat.flushChatPersist()
  }, CHAT_MARKE)
}

// Gegenprobe 01.10.2026: Chat, Code, Chat landed on an empty page and the app
// started empty after a Code session. Both now go back to the chat worked on last.
test('the Chat button goes back to the chat, and so does the start after a Code session', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'New Chat' }).first()).toBeVisible()
  await chatVerlauf(page)
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await openNewChat(page)
  await codeVerlauf(page)
  await expect(page.getByTestId('codex-transcript').getByText(MARKE)).toBeVisible()

  await page.locator('button[title="Chat"][aria-label="Chat"]').first().click()
  await expect(page.getByText(CHAT_MARKE)).toBeVisible()
  await expect(page.getByText(MARKE)).toHaveCount(0)

  // Leave in Code, start again: the Chat tab opens on the same chat.
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await expect(page.getByTestId('codex-transcript').getByText(MARKE)).toBeVisible()
  await page.reload()
  await expect(page.getByText(CHAT_MARKE)).toBeVisible()
  await expect(page.getByTestId('codex-transcript')).toHaveCount(0)
})

test('New on an untouched Code session adds no second empty entry', async ({ page }) => {
  // 3.0.4 box run: every click on New added another empty "Coding Agent".
  await bootCode(page)
  const codeConvs = () => page.evaluate(async () => {
    const chatPath = '/src/stores/chatStore.ts'
    const chat = await import(/* @vite-ignore */ chatPath) as typeof import('../src/stores/chatStore')
    return chat.useChatStore.getState().conversations.filter((c) => c.mode === 'codex').length
  })
  const newButton = page.getByRole('button', { name: 'New', exact: true })
  await newButton.click()
  const before = await codeConvs()
  await newButton.click()
  await newButton.click()
  expect(await codeConvs()).toBe(before)

  // NEGATIVE CONTROL: once the session has a message, New starts a fresh one.
  await codeVerlauf(page)
  await newButton.click()
  expect(await codeConvs()).toBe(before + 1)
})
