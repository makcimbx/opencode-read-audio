import { type Hooks, type Plugin, type PluginInput, type PluginModule, tool } from "@opencode-ai/plugin"
import { resolveOpenRouterAuth } from "./auth"
import { readInputAudios } from "./input-audio"
import { analyzeAudioWithOpenRouter } from "./openrouter"
import type { ReadAudioArgs } from "./types"

const ReadAudioPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      read_audio: tool({
        description:
          "Analyze, describe, compare, transcribe, or answer questions about one or more local audio files using OpenRouter audio-capable models.",
        args: {
          files: tool.schema
            .array(tool.schema.string())
            .describe("Local audio file paths, relative to the project directory unless absolute."),
          prompt: tool.schema.string().describe("Question or instruction for the audio files."),
          model: tool.schema.string().optional().describe("Optional OpenRouter model override for this request."),
        },
        async execute(args: ReadAudioArgs, ctx) {
          const prompt = args.prompt.trim()
          if (!prompt) throw new Error("Prompt must not be empty")

          const auth = resolveOpenRouterAuth(args.model)
          const audios = await readInputAudios(args.files, ctx.directory)
          const answer = await analyzeAudioWithOpenRouter(auth, prompt, audios)

          return {
            output: answer,
            metadata: {
              provider: "openrouter",
              model: auth.model,
              files: audios.map(({ path, format, mime, size }) => ({ path, format, mime, size })),
            },
          }
        },
      }),
    },
  }
}

export default {
  id: "opencode-read-audio",
  server: ReadAudioPlugin,
} satisfies PluginModule
