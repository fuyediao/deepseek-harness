import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
const path = 'C:/Users/l1342/.dsh/sessions/--F-Documents-Harness--/session-c654754f-0fd3-4226-9dea-8c994ade249c/session.v2.jsonl.zstd'
const source = readFileSync(path)

function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid magic at ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

const scan = scanFrames(source)
process.stdout.write(`frames ${scan.frames.length} torn ${scan.tornStart ?? 'none'}\n`)
const parts = []
for (const { start, end } of scan.frames) {
  parts.push(zstdDecompressSync(source.subarray(start, end)).toString('utf8'))
}
const lines = parts.join('').split(/\n/).filter(Boolean)
process.stdout.write(`lines ${lines.length}\n`)
const types = {}
let withAppend = 0
let withReplace = 0
let unmarked = 0
for (const line of lines) {
  const ev = JSON.parse(line)
  const event = ev.event ?? ev
  const t = event.type ?? ev.type ?? 'unknown'
  types[t] = (types[t] ?? 0) + 1
  if (t === 'user/message' || t === 'assistant/message' || t === 'tool/result') {
    const op = event.surfaceOp
    if (op === 'append') withAppend += 1
    else if (op && typeof op === 'object') withReplace += 1
    else unmarked += 1
    if (t === 'user/message') {
      const textBlock = event.data?.content?.[0]?.text ?? ''
      const src = event.data?.source?.kind
      process.stdout.write(`${JSON.stringify({ seq: event.seq, surfaceOp: event.surfaceOp ?? null, src, text: String(textBlock).slice(0, 90) })}\n`)
    }
  }
}
process.stdout.write(`${JSON.stringify({ withAppend, withReplace, unmarked })}\n`)
process.stdout.write(`${JSON.stringify(types, null, 2)}\n`)
