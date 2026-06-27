import type { InputAudio, OpenRouterAuth, OpenRouterChatCompletionResponse, OpenRouterTextPart } from "./types"

interface InputAudioContentPart {
  type: "input_audio"
  input_audio: {
    data: string
    format: string
  }
}

export async function analyzeAudioWithOpenRouter(
  auth: OpenRouterAuth,
  prompt: string,
  audios: InputAudio[],
): Promise<string> {
  const body = {
    model: auth.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...audios.map<InputAudioContentPart>((audio) => ({
            type: "input_audio",
            input_audio: {
              data: audio.base64,
              format: audio.format,
            },
          })),
        ],
      },
    ],
  }

  let response: Response
  try {
    response = await fetch(`${auth.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(`OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}: ${responseText.slice(0, 500)}`)
  }

  let json: OpenRouterChatCompletionResponse
  try {
    json = JSON.parse(responseText) as OpenRouterChatCompletionResponse
  } catch (error) {
    throw new Error(
      `Failed to parse OpenRouter response JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const answer = extractAnswer(json)
  if (!answer) throw new Error("OpenRouter response did not contain a text answer")
  return answer
}

function extractAnswer(response: OpenRouterChatCompletionResponse): string | undefined {
  for (const choice of response.choices ?? []) {
    const content = choice.message?.content
    if (typeof content === "string" && content.trim()) return content.trim()
    if (Array.isArray(content)) {
      const text = content
        .map((part: OpenRouterTextPart) => part.text)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join("\n")
        .trim()
      if (text) return text
    }
  }

  return undefined
}
