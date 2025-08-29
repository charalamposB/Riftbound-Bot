import { promises as fs } from 'fs'
import path from 'path'

/**
 * Διαβάζει JSON αρχείο με fallback.
 */
export async function readJson<T = unknown>(
  file: string,
  fallback: T | null = null
): Promise<T | null> {
  try {
    const data = await fs.readFile(file, 'utf8')
    return JSON.parse(data) as T
  } catch {
    return fallback
  }
}

/**
 * Γράφει JSON με atomic write (πρώτα tmp αρχείο, μετά rename).
 */
export async function writeJsonAtomic(file: string, obj: unknown): Promise<void> {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${path.basename(file)}.tmp`)
  const data = JSON.stringify(obj, null, 2)
  await fs.writeFile(tmp, data, 'utf8')
  await fs.rename(tmp, file)
}