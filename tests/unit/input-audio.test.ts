import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readInputAudio, readInputAudios, resolveAudioPath } from "../../src/input-audio"

const WAV = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([36, 0, 0, 0]),
  Buffer.from("WAVEfmt "),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0, 2, 0, 16, 0]),
  Buffer.from("data"),
  Buffer.from([0, 0, 0, 0]),
])

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "read-audio-input-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("resolveAudioPath", () => {
  test("resolves relative paths against the context directory", () => {
    expect(resolveAudioPath("recording.wav", dir)).toBe(path.resolve(dir, "recording.wav"))
  })

  test("preserves absolute paths", () => {
    const absolute = path.resolve(dir, "recording.wav")
    expect(resolveAudioPath(absolute, "/other")).toBe(absolute)
  })
})

describe("readInputAudio", () => {
  test("encodes an audio file as raw base64 with metadata", async () => {
    const file = path.join(dir, "sample.wav")
    await writeFile(file, WAV)

    expect(await readInputAudio("sample.wav", dir)).toEqual({
      path: file,
      format: "wav",
      base64: WAV.toString("base64"),
      mime: "audio/wav",
      size: WAV.length,
    })
  })

  test("falls back to extension for common audio when magic detection is unavailable", async () => {
    const bytes = Buffer.from("not enough header bytes, but this is a fixture")
    await writeFile(path.join(dir, "sample.mp3"), bytes)

    expect(await readInputAudio("sample.mp3", dir)).toMatchObject({
      format: "mp3",
      base64: bytes.toString("base64"),
      mime: "audio/mpeg",
      size: bytes.length,
    })
  })

  test("rejects unsupported files", async () => {
    await writeFile(path.join(dir, "notes.txt"), "plain text")

    expect(readInputAudio("notes.txt", dir)).rejects.toThrow("Unsupported audio file")
  })

  test("rejects missing and empty files", async () => {
    await writeFile(path.join(dir, "empty.wav"), "")

    expect(readInputAudio("missing.wav", dir)).rejects.toThrow("Failed to read audio file")
    expect(readInputAudio("empty.wav", dir)).rejects.toThrow("Audio file is empty")
  })
})

describe("readInputAudios", () => {
  test("preserves input order", async () => {
    await writeFile(path.join(dir, "first.wav"), WAV)
    await writeFile(path.join(dir, "second.mp3"), Buffer.from("fixture mp3"))

    const audios = await readInputAudios(["first.wav", "second.mp3"], dir)
    expect(audios.map((audio) => path.basename(audio.path))).toEqual(["first.wav", "second.mp3"])
  })

  test("rejects an empty file list", async () => {
    expect(readInputAudios([], dir)).rejects.toThrow("At least one audio file path is required")
  })
})
