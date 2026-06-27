import { readFile } from "node:fs/promises"
import { extname, isAbsolute, resolve } from "node:path"
import { fileTypeFromBuffer } from "file-type"
import type { AudioFormat, InputAudio } from "./types"

const SUPPORTED_FORMATS = new Set<AudioFormat>(["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"])

const MIME_TO_FORMAT: Record<string, AudioFormat> = {
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/x-flac": "flac",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
}

const EXTENSION_TO_FORMAT: Record<string, AudioFormat> = {
  ".aac": "aac",
  ".flac": "flac",
  ".m4a": "m4a",
  ".mp3": "mp3",
  ".ogg": "ogg",
  ".wav": "wav",
  ".webm": "webm",
}

const FORMAT_TO_MIME: Record<AudioFormat, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
}

export function resolveAudioPath(inputPath: string, directory: string): string {
  const trimmed = inputPath.trim()
  if (!trimmed) throw new Error("Audio file path must not be empty")
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(directory, trimmed)
}

export async function readInputAudio(inputPath: string, directory: string): Promise<InputAudio> {
  const path = resolveAudioPath(inputPath, directory)
  let buffer: Buffer
  try {
    buffer = Buffer.from(await readFile(path))
  } catch (error) {
    throw new Error(`Failed to read audio file ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (buffer.length === 0) throw new Error(`Audio file is empty: ${path}`)

  const detected = await fileTypeFromBuffer(buffer)
  const detectedFormat = detected ? MIME_TO_FORMAT[detected.mime] : undefined
  const extensionFormat = EXTENSION_TO_FORMAT[extname(path).toLowerCase()]
  const format = detectedFormat ?? extensionFormat

  if (!format || !SUPPORTED_FORMATS.has(format)) {
    const detectedLabel = detected ? `${detected.mime} (${detected.ext})` : "unknown type"
    throw new Error(
      `Unsupported audio file ${path}: ${detectedLabel}. Supported formats: ${[...SUPPORTED_FORMATS].join(", ")}`,
    )
  }

  return {
    path,
    format,
    base64: buffer.toString("base64"),
    mime: detected?.mime ?? FORMAT_TO_MIME[format],
    size: buffer.length,
  }
}

export async function readInputAudios(paths: string[], directory: string): Promise<InputAudio[]> {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("At least one audio file path is required")
  return Promise.all(paths.map((path) => readInputAudio(path, directory)))
}
