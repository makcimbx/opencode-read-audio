import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const DATA_XDG = mkdtempSync(path.join(os.tmpdir(), "read-audio-auth-"))
const CONFIG_XDG = mkdtempSync(path.join(os.tmpdir(), "read-audio-config-"))
const AUTH_FILE = path.join(DATA_XDG, "opencode", "auth.json")
const CONFIG_FILE = path.join(CONFIG_XDG, "opencode", "opencode.jsonc")

mkdirSync(path.dirname(AUTH_FILE), { recursive: true })
mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })

const ORIGINAL_ENV = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPENCODE_AUTH_CONTENT: process.env.OPENCODE_AUTH_CONTENT,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
}

let normalizeOpenRouterBaseURL: typeof import("../../src/auth").normalizeOpenRouterBaseURL
let resolveOpenRouterAuth: typeof import("../../src/auth").resolveOpenRouterAuth

beforeAll(async () => {
  process.env.XDG_DATA_HOME = DATA_XDG
  process.env.XDG_CONFIG_HOME = CONFIG_XDG
  const auth = await import("../../src/auth")
  normalizeOpenRouterBaseURL = auth.normalizeOpenRouterBaseURL
  resolveOpenRouterAuth = auth.resolveOpenRouterAuth
})

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_BASE_URL
  delete process.env.OPENROUTER_MODEL
  delete process.env.OPENCODE_AUTH_CONTENT
  writeFileSync(AUTH_FILE, "{}")
  writeFileSync(CONFIG_FILE, "{}")
})

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_BASE_URL
  delete process.env.OPENROUTER_MODEL
  delete process.env.OPENCODE_AUTH_CONTENT
})

afterAll(() => {
  restoreEnv("OPENROUTER_API_KEY", ORIGINAL_ENV.OPENROUTER_API_KEY)
  restoreEnv("OPENROUTER_BASE_URL", ORIGINAL_ENV.OPENROUTER_BASE_URL)
  restoreEnv("OPENROUTER_MODEL", ORIGINAL_ENV.OPENROUTER_MODEL)
  restoreEnv("OPENCODE_AUTH_CONTENT", ORIGINAL_ENV.OPENCODE_AUTH_CONTENT)
  restoreEnv("XDG_CONFIG_HOME", ORIGINAL_ENV.XDG_CONFIG_HOME)
  restoreEnv("XDG_DATA_HOME", ORIGINAL_ENV.XDG_DATA_HOME)
})

describe("normalizeOpenRouterBaseURL", () => {
  test("defaults and trims trailing slashes", () => {
    expect(normalizeOpenRouterBaseURL()).toBe("https://openrouter.ai/api/v1")
    expect(normalizeOpenRouterBaseURL("https://openrouter.ai/api/v1///")).toBe("https://openrouter.ai/api/v1")
  })

  test("adds /api/v1 to bare hosts and strips query/hash", () => {
    expect(normalizeOpenRouterBaseURL("https://openrouter.ai?x=1#fragment")).toBe("https://openrouter.ai/api/v1")
    expect(normalizeOpenRouterBaseURL("https://proxy.example/openrouter")).toBe(
      "https://proxy.example/openrouter/api/v1",
    )
  })
})

describe("resolveOpenRouterAuth", () => {
  test("reads API key from env with default base URL and model", () => {
    process.env.OPENROUTER_API_KEY = " env-key "

    expect(resolveOpenRouterAuth()).toEqual({
      apiKey: "env-key",
      baseURL: "https://openrouter.ai/api/v1",
      model: "xiaomi/mimo-v2.6-flash",
    })
  })

  test("applies model override before env and config values", () => {
    process.env.OPENROUTER_API_KEY = "env-key"
    process.env.OPENROUTER_MODEL = "env/model"

    expect(resolveOpenRouterAuth("tool/model").model).toBe("tool/model")
  })

  test("reads OpenRouter key variants from OPENCODE_AUTH_CONTENT", () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openrouter: { token: "auth-token" } })

    expect(resolveOpenRouterAuth().apiKey).toBe("auth-token")
  })

  test("reads provider options from OpenCode config", () => {
    writeFileSync(
      CONFIG_FILE,
      `{
        // JSONC comment should be ignored.
        "provider": {
          "openrouter": {
            "options": {
              "apiKey": "config-key",
              "baseURL": "https://proxy.example",
              "model": "config/model",
            }
          }
        }
      }`,
    )

    expect(resolveOpenRouterAuth()).toEqual({
      apiKey: "config-key",
      baseURL: "https://proxy.example/api/v1",
      model: "config/model",
    })
  })

  test("env values override config values", () => {
    writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ provider: { openrouter: { options: { apiKey: "config-key", model: "config/model" } } } }),
    )
    process.env.OPENROUTER_API_KEY = "env-key"
    process.env.OPENROUTER_MODEL = "env/model"
    process.env.OPENROUTER_BASE_URL = "https://env.example/api/v1/"

    expect(resolveOpenRouterAuth()).toEqual({
      apiKey: "env-key",
      baseURL: "https://env.example/api/v1",
      model: "env/model",
    })
  })

  test("uses V2 credentials and resolved provider settings without reading legacy files", () => {
    writeFileSync(CONFIG_FILE, "not legacy JSON")
    process.env.OPENCODE_AUTH_CONTENT = "not legacy JSON"

    expect(
      resolveOpenRouterAuth(undefined, {
        credential: { type: "key", key: "v2-key" },
        providerOptions: { baseURL: "https://v2.example", model: "v2/model" },
      }),
    ).toEqual({ apiKey: "v2-key", baseURL: "https://v2.example/api/v1", model: "v2/model" })
  })

  test("keeps environment and tool overrides ahead of V2 credentials and settings", () => {
    process.env.OPENROUTER_API_KEY = "env-key"
    process.env.OPENROUTER_MODEL = "env/model"
    process.env.OPENROUTER_BASE_URL = "https://env.example/v1"

    expect(
      resolveOpenRouterAuth("tool/model", {
        credential: { type: "key", key: "v2-key" },
        providerOptions: { apiKey: "settings-key", baseURL: "https://v2.example", model: "v2/model" },
      }),
    ).toEqual({ apiKey: "env-key", baseURL: "https://env.example/v1", model: "tool/model" })
  })

  test("uses V2 settings key when there is no active connection", () => {
    expect(resolveOpenRouterAuth(undefined, { providerOptions: { apiKey: "settings-key" } }).apiKey).toBe(
      "settings-key",
    )
  })

  test("does not reuse V1 credentials when a V2 connection is absent", () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openrouter: { key: "old-key" } })
    expect(() => resolveOpenRouterAuth(undefined, {})).toThrow("OpenRouter API key not found")
  })

  test("throws when no API key is configured", () => {
    expect(() => resolveOpenRouterAuth()).toThrow("OpenRouter API key not found")
  })
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
