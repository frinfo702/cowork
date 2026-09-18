import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const GUARD = resolve(dirname(fileURLToPath(import.meta.url)), "../../.agents/scripts/guard.py")
const MIN_CHARS = 180
const MAX_CHARS = 12000
const TIMEOUT_MS = 6000

const textOf = (parts) =>
  (parts ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()

export const AnswerGuard = async ({ client, $ }) => {
  const prompts = new Map()
  const verdicts = new Map()
  const children = new Map()

  async function lastPrompt(sessionID) {
    const remembered = prompts.get(sessionID)
    if (remembered) return remembered
    try {
      const messages = (await client.session.messages({ path: { id: sessionID }, query: { limit: 20 } }))?.data ?? []
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.info?.role !== "user") continue
        const text = textOf(messages[index].parts)
        if (text) return text
      }
    } catch {}
    return ""
  }

  async function isChild(sessionID) {
    if (children.has(sessionID)) return children.get(sessionID)
    let child = false
    try {
      child = Boolean((await client.session.get({ path: { id: sessionID } }))?.data?.parentID)
    } catch {}
    children.set(sessionID, child)
    return child
  }

  async function check(prompt, draft) {
    const dir = mkdtempSync(join(tmpdir(), "answer-guard-"))
    try {
      const file = join(dir, "payload.json")
      writeFileSync(file, JSON.stringify({ prompt, draft }), "utf8")
      const run = $`python3 ${GUARD} --fast --in ${file}`.quiet().nothrow()
      const result = await Promise.race([run, new Promise((done) => setTimeout(() => done(null), TIMEOUT_MS))])
      if (!result || result.exitCode !== 0) return null
      return JSON.parse(String(result.stdout))
    } catch {
      return null
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  return {
    "chat.message": async (input, output) => {
      const text = textOf(output?.parts)
      if (text) prompts.set(input.sessionID, text)
    },

    "experimental.chat.system.transform": async (input, output) => {
      const verdict = input.sessionID ? verdicts.get(input.sessionID) : null
      if (!verdict) return
      verdicts.delete(input.sessionID)
      output.system.push(
        `前回の回答は過剰だった (over=${verdict.over}, ai=${verdict.ai})。今回は質問への直接回答だけを書く。前置き・先回り・補足・まとめを足さない。`
      )
    },

    "experimental.text.complete": async (input, output) => {
      try {
        const draft = output?.text ?? ""
        if (draft.length < MIN_CHARS || draft.length > MAX_CHARS) return
        if (await isChild(input.sessionID)) return
        const prompt = await lastPrompt(input.sessionID)
        if (!prompt) return
        const result = await check(prompt, draft)
        if (!result || result.source !== "jev") return
        if (result.excessive) {
          verdicts.set(input.sessionID, {
            over: result.verdict?.over_answer,
            ai: result.verdict?.ai_speak,
          })
        }
        if (result.trimmed && typeof result.text === "string" && result.text.trim()) {
          output.text = result.text
        }
      } catch {}
    },
  }
}
