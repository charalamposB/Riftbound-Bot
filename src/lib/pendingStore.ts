// src/lib/pendingStore.ts
import path from 'path'
import fs from 'fs/promises'
import { readJson, writeJsonAtomic } from '../lib/jsonStore'

export type SlashAttachment = { id: string; url: string; name: string }
export type Kind = 'sell' | 'buy'

export type PendingSlash = {
  userId: string
  kind: Kind
  photo1: SlashAttachment
  photo2?: SlashAttachment | null
  createdAt: number
}

export type PendingApproval = {
  pid: string
  guildId: string
  requesterId: string
  kind: Kind
  cardName: string
  quantity: number
  price?: number | null
  location: string
  extra?: string | null
  photo1?: SlashAttachment | null
  photo2?: SlashAttachment | null
  caseThreadId: string
  caseMessageId: string
  postedChannelId?: string
  postedMessageId?: string
  contacts?: string[]
  createdAt: number
}

// 🔒 project root (δουλεύει και από src και από dist)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const DATA_DIR = path.join(PROJECT_ROOT, 'data')
const FILES = {
  slash: path.join(DATA_DIR, 'pending_slash.json'),
  approvals: path.join(DATA_DIR, 'pending_approvals.json'),
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try { await fs.access(FILES.slash) } catch { await writeJsonAtomic(FILES.slash, {}) }
  try { await fs.access(FILES.approvals) } catch { await writeJsonAtomic(FILES.approvals, {}) }
}

const mem = {
  slash: new Map<string, PendingSlash>(),
  approvals: new Map<string, PendingApproval>(),
}

export async function init() {
  await ensureDataFiles()
  const s = (await readJson<Record<string, PendingSlash>>(FILES.slash, {}))!
  const a = (await readJson<Record<string, PendingApproval>>(FILES.approvals, {}))!
  mem.slash = new Map(Object.entries(s))
  mem.approvals = new Map(Object.entries(a))
}

async function flushSlash()     { await writeJsonAtomic(FILES.slash,     Object.fromEntries(mem.slash)) }
async function flushApprovals() { await writeJsonAtomic(FILES.approvals, Object.fromEntries(mem.approvals)) }

export function getSlash(userId: string) { return mem.slash.get(userId) }
export async function setSlash(v: PendingSlash) { mem.slash.set(v.userId, v); await flushSlash() }
export async function deleteSlash(userId: string) { mem.slash.delete(userId); await flushSlash() }

export function getApproval(pid: string) { return mem.approvals.get(pid) }
export async function setApproval(v: PendingApproval) { mem.approvals.set(v.pid, v); await flushApprovals() }
export async function deleteApproval(pid: string) { mem.approvals.delete(pid); await flushApprovals() }

export async function expireOlderThan(ms: number) {
  const now = Date.now()
  let sC = false, aC = false
  for (const [k, v] of mem.slash)     if (now - v.createdAt > ms) { mem.slash.delete(k); sC = true }
  for (const [k, v] of mem.approvals) if (now - v.createdAt > ms) { mem.approvals.delete(k); aC = true }
  if (sC) await flushSlash()
  if (aC) await flushApprovals()
}

// pendingStore.ts
export function debugPendingInfo() {
  return {
    files: FILES,
    counts: { slash: mem.slash.size, approvals: mem.approvals.size },
  }
}
