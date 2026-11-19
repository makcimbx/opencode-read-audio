import type {
  InputAudio,
  OpenRouterAuth,
  OpenRouterChatCompletionChoice,
  OpenRouterChatCompletionResponse,
} from "./types"

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
  signal?: AbortSignal,
): Promise<string> {
  const body = {
    model: auth.model,
    // MiMo Flash can stop after reasoning without returning a text answer.
    ...(auth.model.split(":")[0] === "xiaomi/mimo-v2.6-flash" && { reasoning: { enabled: false } }),
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
      signal,
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

  const choices = Array.isArray(json?.choices) ? json.choices : []
  const failedChoice = choices.find((choice) => choice?.error || choice?.finish_reason === "error")
  const failed = json?.error || failedChoice
  const answer = failed ? undefined : extractAnswer(choices)
  if (answer) return answer

  const errorMessage = (json?.error ?? failedChoice?.error)?.message
  const finishReason = (failedChoice ?? choices[0])?.finish_reason
  const details = [
    `model=${auth.model}`,
    json?.provider && `provider=${json.provider}`,
    finishReason && `finish_reason=${finishReason}`,
    json?.id && `id=${json.id}`,
  ]
    .filter(Boolean)
    .join(", ")
  const message = failed ? "OpenRouter completion failed" : "OpenRouter response did not contain a text answer"
  throw new Error(`${message} (${details})${typeof errorMessage === "string" ? `: ${errorMessage.slice(0, 500)}` : ""}`)
}

function extractAnswer(choices: OpenRouterChatCompletionChoice[]): string | undefined {
  for (const choice of choices) {
    const content = choice?.message?.content
    if (typeof content === "string" && content.trim()) return content.trim()
    if (Array.isArray(content)) {
      const text = content
        .map((part) => part?.text)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join("\n")
        .trim()
      if (text) return text
    }
  }

  return undefined
}
