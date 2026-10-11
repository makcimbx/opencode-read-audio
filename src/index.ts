import { Plugin as PluginV2 } from "@opencode/plugin"
import { type Hooks, type Plugin, type PluginInput, type PluginModule, tool } from "@opencode-ai/plugin"
import { type OpenRouterAuthSource, resolveOpenRouterAuth } from "./auth"
import { readInputAudios } from "./input-audio"
import { analyzeAudioWithOpenRouter } from "./openrouter"
import type { ReadAudioArgs } from "./types"

const DESCRIPTION =
  "Analyze, describe, compare, transcribe, or answer questions about one or more local audio files using OpenRouter audio-capable models."
const FILES_DESCRIPTION = "Local audio file paths, relative to the project directory unless absolute."
const PROMPT_DESCRIPTION = "Question or instruction for the audio files."
const MODEL_DESCRIPTION = "Optional OpenRouter model override for this request."

async function readAudio(args: ReadAudioArgs, directory: string, signal: AbortSignal, source?: OpenRouterAuthSource) {
  const prompt = args.prompt.trim()
  if (!prompt) throw new Error("Prompt must not be empty")
  signal.throwIfAborted()

  const auth = resolveOpenRouterAuth(args.model, source)
  const audios = await readInputAudios(args.files, directory)
  signal.throwIfAborted()
  const answer = await analyzeAudioWithOpenRouter(auth, prompt, audios, signal)

  return {
    output: answer,
    metadata: {
      provider: "openrouter",
      model: auth.model,
      files: audios.map(({ path, format, mime, size }) => ({ path, format, mime, size })),
    },
  }
}

const ReadAudioPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      read_audio: tool({
        description: DESCRIPTION,
        args: {
          files: tool.schema.array(tool.schema.string()).min(1).describe(FILES_DESCRIPTION),
          prompt: tool.schema.string().describe(PROMPT_DESCRIPTION),
          model: tool.schema.string().optional().describe(MODEL_DESCRIPTION),
        },
        execute(args: ReadAudioArgs, ctx) {
          return readAudio(args, ctx.directory, ctx.abort)
        },
      }),
    },
  }
}

export default {
  ...PluginV2.define({
    id: "opencode-read-audio",
    async setup(ctx) {
      await ctx.tool.transform((editor) => {
        editor.add({
          name: "read_audio",
          description: DESCRIPTION,
          input: {
            type: "object",
            properties: {
              files: { type: "array", items: { type: "string" }, minItems: 1, description: FILES_DESCRIPTION },
              prompt: { type: "string", description: PROMPT_DESCRIPTION },
              model: { type: "string", description: MODEL_DESCRIPTION },
            },
            required: ["files", "prompt"],
            additionalProperties: false,
          },
          async execute(input, context) {
            context.signal.throwIfAborted()
            const session = await ctx.session.get({ sessionID: context.sessionID })
            const providers = await ctx.provider.list({ location: session.location })
            const provider = providers.data.find((item) => item.id === "openrouter")
            const connection = process.env.OPENROUTER_API_KEY?.trim()
              ? undefined
              : await ctx.integration.connection.active(provider?.integrationID ?? "openrouter")
            const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined
            const result = await readAudio(input as ReadAudioArgs, session.location.directory, context.signal, {
              credential,
              providerOptions: provider?.settings,
            })

            return { content: result.output, metadata: result.metadata }
          },
        })
      })
    },
  }),
  server: ReadAudioPlugin,
} satisfies PluginModule & PluginV2.Plugin
