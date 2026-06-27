export type AudioFormat = "wav" | "mp3" | "flac" | "m4a" | "ogg" | "webm" | "aac"

export interface InputAudio {
  path: string
  format: AudioFormat
  base64: string
  mime: string
  size: number
}

export interface OpenRouterAuth {
  apiKey: string
  baseURL: string
  model: string
}

export interface ReadAudioArgs {
  files: string[]
  prompt: string
  model?: string
}

export interface OpenRouterTextPart {
  type?: string
  text?: string
}

export interface OpenRouterChatCompletionChoice {
  message?: {
    content?: string | OpenRouterTextPart[] | null
  }
}

export interface OpenRouterChatCompletionResponse {
  choices?: OpenRouterChatCompletionChoice[]
}
