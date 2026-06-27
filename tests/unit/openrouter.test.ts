import { afterEach, describe, expect, mock, test } from "bun:test"
import { analyzeAudioWithOpenRouter } from "../../src/openrouter"
import type { InputAudio, OpenRouterAuth } from "../../src/types"

describe("analyzeAudioWithOpenRouter", () => {
  const originalFetch = globalThis.fetch
  const auth: OpenRouterAuth = { apiKey: "or-key", baseURL: "https://openrouter.ai/api/v1", model: "audio/model" }
  const audios: InputAudio[] = [
    { path: "/tmp/one.wav", format: "wav", base64: "V0FW", mime: "audio/wav", size: 3 },
    { path: "/tmp/two.mp3", format: "mp3", base64: "TVAz", mime: "audio/mpeg", size: 3 },
  ]

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("posts chat completions with text and raw input_audio parts", async () => {
    const fetchMock = mock(async (_url: string, _init: RequestInit) =>
      Response.json({ choices: [{ message: { content: "Audio summary" } }] }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect(await analyzeAudioWithOpenRouter(auth, "Describe these", audios)).toBe("Audio summary")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({
      Authorization: "Bearer or-key",
      "Content-Type": "application/json",
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: "audio/model",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe these" },
            { type: "input_audio", input_audio: { data: "V0FW", format: "wav" } },
            { type: "input_audio", input_audio: { data: "TVAz", format: "mp3" } },
          ],
        },
      ],
    })
  })

  test("parses array text parts", async () => {
    const fetchMock = mock(async () =>
      Response.json({ choices: [{ message: { content: [{ type: "text", text: "Part 1" }, { text: "Part 2" }] } }] }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect(await analyzeAudioWithOpenRouter(auth, "Describe", audios)).toBe("Part 1\nPart 2")
  })

  test("throws with status and response body for non-OK responses", async () => {
    const fetchMock = mock(async () => new Response("upstream boom", { status: 429 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect(analyzeAudioWithOpenRouter(auth, "Describe", audios)).rejects.toThrow(
      "OpenRouter request failed with status 429: upstream boom",
    )
  })

  test("throws for malformed JSON and empty choices", async () => {
    globalThis.fetch = mock(async () => new Response("not json")) as unknown as typeof fetch
    expect(analyzeAudioWithOpenRouter(auth, "Describe", audios)).rejects.toThrow(
      "Failed to parse OpenRouter response JSON",
    )

    globalThis.fetch = mock(async () => Response.json({ choices: [] })) as unknown as typeof fetch
    expect(analyzeAudioWithOpenRouter(auth, "Describe", audios)).rejects.toThrow(
      "OpenRouter response did not contain a text answer",
    )
  })
})
