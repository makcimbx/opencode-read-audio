import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { xdgConfig, xdgData } from "xdg-basedir"
import type { OpenRouterAuth } from "./types"

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const DEFAULT_OPENROUTER_MODEL = "xiaomi/mimo-v2.5"

interface OpenCodeAuthData {
  openrouter?: unknown
}

interface OpenCodeConfig {
  provider?: {
    openrouter?: {
      options?: Record<string, unknown>
    }
  }
}

export function normalizeOpenRouterBaseURL(raw?: string): string {
  const fallback = DEFAULT_OPENROUTER_BASE_URL
  const value = raw?.trim() || fallback

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid OpenRouter base URL: ${value}`)
  }

  url.search = ""
  url.hash = ""
  url.pathname = url.pathname.replace(/\/+$/, "")
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/api/v1"
  } else if (!url.pathname.endsWith("/api/v1") && !url.pathname.endsWith("/v1")) {
    url.pathname = `${url.pathname}/api/v1`
  }

  return url.toString().replace(/\/+$/, "")
}

export function resolveOpenRouterAuth(modelOverride?: string): OpenRouterAuth {
  const config = loadOpenCodeConfig()
  const providerOptions = config?.provider?.openrouter?.options
  const apiKey =
    readString(process.env.OPENROUTER_API_KEY) ??
    extractApiKey(loadAuthData()?.openrouter) ??
    readString(providerOptions?.apiKey)
  const model =
    readString(modelOverride) ??
    readString(process.env.OPENROUTER_MODEL) ??
    readString(providerOptions?.model) ??
    DEFAULT_OPENROUTER_MODEL
  const baseURL = normalizeOpenRouterBaseURL(
    readString(process.env.OPENROUTER_BASE_URL) ?? readString(providerOptions?.baseURL),
  )

  if (!apiKey) {
    throw new Error(
      "OpenRouter API key not found. Set OPENROUTER_API_KEY or configure provider.openrouter.options.apiKey in opencode config.",
    )
  }

  return { apiKey, baseURL, model }
}

function loadAuthData(): OpenCodeAuthData | undefined {
  const inline = process.env.OPENCODE_AUTH_CONTENT
  if (inline?.trim()) {
    return parseJsonObject(inline, "OPENCODE_AUTH_CONTENT") as OpenCodeAuthData
  }

  const authPath = xdgData ? join(xdgData, "opencode", "auth.json") : undefined
  if (!authPath || !existsSync(authPath)) return undefined

  return parseJsonObject(readFileSync(authPath, "utf8"), authPath) as OpenCodeAuthData
}

function loadOpenCodeConfig(): OpenCodeConfig | undefined {
  if (!xdgConfig) return undefined

  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const path = join(xdgConfig, "opencode", name)
    if (existsSync(path)) {
      return parseJsonObject(parseJsonc(readFileSync(path, "utf8")), path) as OpenCodeConfig
    }
  }

  return undefined
}

function parseJsonObject(content: string, source: string): unknown {
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Failed to parse ${source}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseJsonc(raw: string): string {
  return stripJsonComments(raw).replace(/,\s*([}\]])/g, "$1")
}

function extractApiKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  return readString(record.key) ?? readString(record.apiKey) ?? readString(record.access) ?? readString(record.token)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stripJsonComments(input: string): string {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    const next = input[index + 1]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }

    if (char === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index++
      output += "\n"
      continue
    }

    if (char === "/" && next === "*") {
      index += 2
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) index++
      index++
      continue
    }

    output += char
  }

  return output
}
