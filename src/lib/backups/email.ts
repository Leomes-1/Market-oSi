import nodemailer from 'nodemailer'
import { backupBucket, listSnapshots, type SnapshotEntry } from './storage'
import { takeSnapshot } from './snapshot'

/**
 * Weekly off-site copy: the newest snapshot, emailed to the shop's Gmail.
 *
 * Storage snapshots live in the same Supabase project as the data they back
 * up, so losing the project would take both. The email puts one copy
 * somewhere else entirely. It runs from a Vercel Cron job (Sunday 20:00 UTC)
 * and from the "Dërgo tani në email" button.
 *
 * Every attempt, good or bad, is recorded in status/last-email.json so the
 * backup page can warn when the weekly copy has stopped arriving.
 */

const STATUS_PATH = 'status/last-email.json'

/** Reuse the newest snapshot only if it is at most this old. */
const MAX_SNAPSHOT_AGE_MS = 60 * 60 * 1000

const TZ = 'Europe/Tirane'

export type EmailTrigger = 'cron' | 'manual'

export interface EmailStatus {
  /** When the last attempt finished. */
  at: string
  ok: boolean
  trigger: EmailTrigger
  /** Last successful send, kept across failures so the page can show it. */
  lastSuccessAt: string | null
  snapshotPath?: string
  snapshotCreatedAt?: string
  size?: number
  error?: string
}

/** Whether the Gmail variables are present. Never exposes their values. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
}

export async function readEmailStatus(): Promise<EmailStatus | null> {
  const bucket = await backupBucket()
  const { data, error } = await bucket.download(STATUS_PATH)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text()) as EmailStatus
  } catch {
    return null
  }
}

async function writeEmailStatus(status: EmailStatus): Promise<void> {
  try {
    const bucket = await backupBucket()
    const { error } = await bucket.upload(STATUS_PATH, JSON.stringify(status), {
      contentType: 'application/json',
      upsert: true,
    })
    if (error) throw error
  } catch (error) {
    console.error('Backup email: could not record the status:', error)
  }
}

/** YYYY-MM-DD on the Albanian calendar. */
function tiraneDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}

function tiraneDateTime(iso: string): string {
  return new Date(iso).toLocaleString('sq-AL', { timeZone: TZ })
}

/** The newest snapshot if it is fresh enough, otherwise a new one. */
async function freshSnapshot(): Promise<SnapshotEntry> {
  const [latest] = await listSnapshots(undefined, 1)
  if (latest && Date.now() - new Date(latest.createdAt).getTime() <= MAX_SNAPSHOT_AGE_MS) {
    return latest
  }
  return takeSnapshot('manual')
}

function bodyText(snapshot: SnapshotEntry): string {
  const counts = Object.entries(snapshot.rowCounts)
    .map(([table, n]) => `  ${table}: ${n}`)
    .join('\n')
  return [
    'Backup automatik i Market OS.',
    '',
    `Snapshot-i: ${tiraneDateTime(snapshot.createdAt)} (ora e Shqipërisë)`,
    `Skedari në Storage: ${snapshot.path}`,
    '',
    'Rreshta për tabelë:',
    counts,
    '',
    'Për ta rikthyer: Backup & Rikthim → Ngarko backup → zgjidh këtë skedar.',
  ].join('\n')
}

/**
 * Emails the newest snapshot (taking one if it is older than an hour) and
 * records the outcome. Throws on failure, after recording it.
 */
export async function emailLatestSnapshot(trigger: EmailTrigger): Promise<EmailStatus> {
  const previous = await readEmailStatus().catch(() => null)
  const lastSuccessAt = previous?.ok ? previous.at : previous?.lastSuccessAt ?? null

  try {
    const user = process.env.GMAIL_USER
    const pass = process.env.GMAIL_APP_PASSWORD
    if (!user || !pass) {
      throw new Error('GMAIL_USER ose GMAIL_APP_PASSWORD nuk është vendosur.')
    }

    const snapshot = await freshSnapshot()
    const bucket = await backupBucket()
    const { data, error } = await bucket.download(snapshot.path)
    if (error || !data) throw new Error(`Snapshot-i nuk u shkarkua: ${error?.message ?? 'bosh'}`)
    const content = Buffer.from(await data.arrayBuffer())

    const day = tiraneDate(snapshot.createdAt)
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    })
    await transport.sendMail({
      from: `Market OS <${user}>`,
      to: user,
      subject: `Market OS backup ${day}`,
      text: bodyText(snapshot),
      attachments: [
        { filename: `market-os-${day}.json.gz`, content, contentType: 'application/gzip' },
      ],
    })

    const status: EmailStatus = {
      at: new Date().toISOString(),
      ok: true,
      trigger,
      lastSuccessAt: new Date().toISOString(),
      snapshotPath: snapshot.path,
      snapshotCreatedAt: snapshot.createdAt,
      size: content.length,
    }
    await writeEmailStatus(status)
    return status
  } catch (error) {
    console.error(`Backup email (${trigger}) failed:`, error)
    await writeEmailStatus({
      at: new Date().toISOString(),
      ok: false,
      trigger,
      lastSuccessAt,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
