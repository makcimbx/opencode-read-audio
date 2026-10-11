import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool"
import type { PluginInput } from "@opencode-ai/plugin"

const DIRECTORY = mkdtempSync(join(tmpdir(), "read-audio-plugin-"))
const AUDIO_PATH = join(DIRECTORY, "sample.wav")
const ORIGINAL_FETCH = globalThis.fetch
const ENV_KEYS = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_BASE_URL", "OPENCODE_AUTH_CONTENT"] as const
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
const SIGNAL = new AbortController().signal
const V2_CONTEXT = { sessionID: "session-1", signal: SIGNAL } as ToolContext
const requests: { url: string; init?: RequestInit }[] = []
let plugin: typeof import("../../src/index").default

beforeAll(async () => {
  const wav = Buffer.alloc(44)
  wav.write("RIFF", 0)
  wav.writeUInt32LE(36, 4)
  wav.write("WAVE", 8)
  writeFileSync(AUDIO_PATH, wav)
  plugin = (await import("../../src/index")).default
})

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  requests.length = 0
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return Response.json({ choices: [{ message: { content: "Audio answer" } }] })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = ORIGINAL_ENV[key]
  }
})

afterAll(() => rmSync(DIRECTORY, { recursive: true, force: true }))

async function setupV2() {
  const tools: Info[] = []
  const editor = { add: (info: Info) => tools.push(info) } as unknown as ToolEditor
  let transform: ((editor: ToolEditor) => void) | undefined
  let key = "connection-key"
  const sessionGet = mock(async () => ({ location: { directory: DIRECTORY } }))
  const providerList = mock(async () => ({
    data: [{ id: "openrouter", integrationID: "router-account", settings: { baseURL: "https://proxy.example/v1" } }],
  }))
  const active = mock(async () => ({ type: "credential", id: "credential-1", method: "key", label: "OpenRouter" }))
  const resolve = mock(async () => ({ type: "key", key }))
  const context = {
    location: { directory: join(DIRECTORY, "different-plugin-location") },
    tool: {
      transform: mock(async (callback: (editor: ToolEditor) => void) => {
        transform = callback
        callback(editor)
        return { dispose() {} }
      }),
    },
    session: { get: sessionGet },
    provider: { list: providerList },
    integration: { connection: { active, resolve } },
  } as unknown as Plugin.Context

  await plugin.setup(context)
  const tool = tools[0]
  if (!tool) throw new Error("V2 read_audio tool was not registered")
  return {
    tools,
    tool,
    sessionGet,
    providerList,
    active,
    resolve,
    replay: () => transform?.(editor),
    switchKey: (value: string) => {
      key = value
    },
  }
}

describe("OpenCode plugin compatibility", () => {
  test("V1 keeps its tool result and resolves paths from the execution directory", async () => {
    process.env.OPENROUTER_API_KEY = "v1-key"
    const hooks = await plugin.server({} as PluginInput)
    const tool = hooks.tool?.read_audio
    if (!tool) throw new Error("V1 read_audio tool was not registered")
    const result = await tool.execute(
      { files: ["sample.wav"], prompt: " Summarize the recording " },
      {
        sessionID: "session-1",
        messageID: "message-1",
        agent: "build",
        directory: DIRECTORY,
        worktree: DIRECTORY,
        abort: SIGNAL,
        metadata() {},
        async ask() {},
      },
    )

    expect(result).toEqual({
      output: "Audio answer",
      metadata: {
        provider: "openrouter",
        model: "xiaomi/mimo-v2.6-flash",
        files: [{ path: AUDIO_PATH, format: "wav", mime: "audio/wav", size: 44 }],
      },
    })
    expect(requests[0]?.init?.signal).toBe(SIGNAL)
  })

  test("V2 registers a replayable JSON Schema tool without runtime API calls", async () => {
    const runtime = await setupV2()
    expect(plugin.id).toBe("opencode-read-audio")
    expect(runtime.tools).toHaveLength(1)
    expect(runtime.tools[0]?.name).toBe("read_audio")
    expect(runtime.tools[0]?.input).toMatchObject({
      type: "object",
      required: ["files", "prompt"],
      additionalProperties: false,
      properties: { files: { type: "array", minItems: 1 }, model: { type: "string" } },
    })
    runtime.replay()
    expect(runtime.tools).toHaveLength(2)
    expect(runtime.sessionGet).not.toHaveBeenCalled()
    expect(runtime.providerList).not.toHaveBeenCalled()
    expect(runtime.active).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  })

  test("V2 uses the session location, active credentials, provider settings and structured content", async () => {
    process.env.OPENCODE_AUTH_CONTENT = "invalid legacy auth must not be read"
    const runtime = await setupV2()
    const result = await runtime.tool.execute(
      { files: ["sample.wav"], prompt: " Summarize ", model: "tool/audio-model" },
      V2_CONTEXT,
    )

    expect(runtime.sessionGet).toHaveBeenCalledWith({ sessionID: "session-1" })
    expect(runtime.providerList).toHaveBeenCalledWith({ location: { directory: DIRECTORY } })
    expect(runtime.active).toHaveBeenCalledWith("router-account")
    expect(result.content).toBe("Audio answer")
    expect(result.metadata?.model).toBe("tool/audio-model")
    expect(result.metadata?.files[0].path).toBe(AUDIO_PATH)
    expect(requests[0]?.url).toBe("https://proxy.example/v1/chat/completions")
    expect(requests[0]?.init?.headers).toMatchObject({ Authorization: "Bearer connection-key" })
    expect(requests[0]?.init?.signal).toBe(SIGNAL)
    const body = JSON.parse(String(requests[0]?.init?.body))
    expect(body.model).toBe("tool/audio-model")
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "Summarize" })

    runtime.switchKey("new-account-key")
    await runtime.tool.execute({ files: ["sample.wav"], prompt: "Summarize" }, V2_CONTEXT)
    expect(requests[1]?.init?.headers).toMatchObject({ Authorization: "Bearer new-account-key" })
  })

  test("V2 environment credentials skip connection resolution", async () => {
    process.env.OPENROUTER_API_KEY = " env-key "
    process.env.OPENROUTER_BASE_URL = "https://env.example/v1"
    const runtime = await setupV2()
    await runtime.tool.execute({ files: ["sample.wav"], prompt: "Summarize" }, V2_CONTEXT)
    expect(runtime.active).not.toHaveBeenCalled()
    expect(runtime.resolve).not.toHaveBeenCalled()
    expect(requests[0]?.url).toBe("https://env.example/v1/chat/completions")
    expect(requests[0]?.init?.headers).toMatchObject({ Authorization: "Bearer env-key" })
  })

  test("V2 rejects blank prompts before sending an OpenRouter request", async () => {
    const runtime = await setupV2()
    await expect(runtime.tool.execute({ files: ["sample.wav"], prompt: "  " }, V2_CONTEXT)).rejects.toThrow(
      "Prompt must not be empty",
    )
    expect(requests).toHaveLength(0)
  })

  test("V2 cancelled calls do not query the session or send a request", async () => {
    const runtime = await setupV2()
    const controller = new AbortController()
    controller.abort(new Error("Tool cancelled"))
    await expect(
      runtime.tool.execute(
        { files: ["sample.wav"], prompt: "Summarize" },
        { ...V2_CONTEXT, signal: controller.signal },
      ),
    ).rejects.toThrow("Tool cancelled")
    expect(runtime.sessionGet).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  })
})
