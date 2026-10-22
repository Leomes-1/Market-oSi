'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import AccessDenied from '@/components/AccessDenied'
import { useRole } from '@/contexts/RoleContext'
import {
  RiAlertLine,
  RiDatabase2Line,
  RiDownloadLine,
  RiFlaskLine,
  RiHistoryLine,
  RiMailSendLine,
  RiSaveLine,
  RiUploadLine,
} from 'react-icons/ri'

type Kind = 'auto' | 'manual' | 'pre-restore'

interface Snapshot {
  path: string
  createdAt: string
  kind: Kind
  rowCounts: Record<string, number>
  restoredFrom: string | null
  size: number | null
}

interface Failure {
  at: string
  context: string
  message: string
}

interface EmailStatus {
  at: string
  ok: boolean
  trigger: 'cron' | 'manual'
  lastSuccessAt: string | null
  error?: string
}

interface Status {
  configured: boolean
  problem: string | null
  snapshots: Snapshot[]
  /** Every snapshot, when `snapshots` is the capped newest-first list. */
  total?: number
  lastFailure: Failure | null
  lastEmail: EmailStatus | null
  emailConfigured: boolean
}

/** The weekly email is sent on Sundays; warn once it is a day overdue. */
const EMAIL_STALE_MS = 8 * 24 * 60 * 60 * 1000

interface Preview {
  createdAt: string
  current: Record<string, number>
  snapshot: Record<string, number>
  problems: string[]
  adminAction: AdminAction
}

type AdminAction = 'unchanged' | 'promoted' | 'inserted'

interface SequenceCheck {
  maxId: number | null
  nextId: number
  ok: boolean
}

interface DryRun {
  snapshot: Record<string, number>
  expected: Record<string, number>
  restored: Record<string, number>
  countsMatch: boolean
  adminAction: AdminAction
  sequences: Record<string, SequenceCheck>
  sequencesOk: boolean
  publicUnchanged: boolean
  schemaDropped: boolean
  ok: boolean
}

interface RestoreResult {
  preRestore: Snapshot
  before: Record<string, number>
  after: Record<string, number>
  verified: boolean
  adminAction: AdminAction
}

const CONFIRM_WORD = 'RIKTHE'

/** Matches the server's cap, which sits under Vercel's 4.5 MB body limit. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

interface UploadPreview extends Preview {
  fileName: string
  kind: string
}

/** The steps of "Ngarko backup", strictly in this order. */
type UploadStep = 'checking' | 'checked' | 'dry-running' | 'dry-run' | 'restoring' | 'restored'

/** Albanian names, in the order the counts are shown. */
const TABLE_LABELS: Record<string, string> = {
  Product: 'Produkte',
  ProductBarcode: 'Barkode',
  Supplier: 'Furnitorë',
  Supply: 'Furnizime',
  SupplyItem: 'Rreshta furnizimi',
  Sale: 'Shitje',
  SaleItem: 'Rreshta shitjeje',
  PersonalUseEntry: 'Përdorim vetjak',
  PersonalUse: 'Rreshta përdorimi',
  UserRole: 'Përdorues',
}

const KIND_LABELS: Record<Kind, { label: string; className: string }> = {
  auto: { label: 'Automatik', className: 'badge-gray' },
  manual: { label: 'Manual', className: 'badge-blue' },
  'pre-restore': { label: 'Para rikthimit', className: 'badge-yellow' },
}

const ADMIN_ACTION_LABELS: Record<AdminAction, string> = {
  unchanged: 'Ti mbetesh admin (je admin edhe në snapshot).',
  promoted: 'Në snapshot nuk je admin — roli yt do të rikthehet në admin.',
  inserted: 'Në snapshot nuk ekziston llogaria jote — do të shtohet si admin.',
}

const TZ = 'Europe/Tirane'

function tableNames(...maps: Record<string, number>[]): string[] {
  const names = new Set(maps.flatMap((m) => Object.keys(m)))
  const known = Object.keys(TABLE_LABELS).filter((t) => names.has(t))
  return [...known, ...Array.from(names).filter((t) => !TABLE_LABELS[t]).sort()]
}

function label(table: string) {
  return TABLE_LABELS[table] ?? table
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('sq-AL', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('sq-AL', { timeZone: TZ })
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('sq-AL', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatSize(bytes: number | null) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(0)} KB`
}

async function readError(res: Response, fallback: string) {
  try {
    const body = await res.json()
    return typeof body?.error === 'string' ? body.error : fallback
  } catch {
    return fallback
  }
}

export default function BackupPage() {
  const { role } = useRole()
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  // The list is capped to the newest snapshots unless asked for all.
  const [showAll, setShowAll] = useState(false)
  const [creating, setCreating] = useState(false)
  const [emailing, setEmailing] = useState(false)

  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)

  // Ngarko backup
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadStep, setUploadStep] = useState<UploadStep>('checking')
  const [uploadPreview, setUploadPreview] = useState<UploadPreview | null>(null)
  const [uploadDryRun, setUploadDryRun] = useState<DryRun | null>(null)
  const [uploadResult, setUploadResult] = useState<RestoreResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadConfirm, setUploadConfirm] = useState('')

  const [dryRunTarget, setDryRunTarget] = useState<Snapshot | null>(null)
  const [dryRun, setDryRun] = useState<DryRun | null>(null)
  const [dryRunError, setDryRunError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(showAll ? '/api/backups?all=1' : '/api/backups')
      if (!res.ok) throw new Error(await readError(res, 'Gabim gjatë ngarkimit të backup-eve'))
      setStatus(await res.json())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gabim gjatë ngarkimit të backup-eve')
    } finally {
      setLoading(false)
    }
  }, [showAll])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const groups = useMemo(() => {
    const byDay = new Map<string, Snapshot[]>()
    for (const s of status?.snapshots ?? []) {
      const key = dayKey(s.createdAt)
      byDay.set(key, [...(byDay.get(key) ?? []), s])
    }
    return Array.from(byDay.entries())
  }, [status])

  const latest = status?.snapshots[0] ?? null

  const lastEmail = status?.lastEmail ?? null
  const lastEmailSuccess = lastEmail?.lastSuccessAt ?? null
  // Date.now() at render is fine here: the page re-renders on every fetch.
  const emailProblem: string | null = !status?.configured
    ? null
    : !status.emailConfigured
    ? 'GMAIL_USER / GMAIL_APP_PASSWORD nuk janë vendosur — backup-i javor me email nuk dërgohet.'
    : lastEmail && !lastEmail.ok
    ? `Email-i i fundit dështoi më ${formatDateTime(lastEmail.at)}: ${lastEmail.error ?? 'gabim i panjohur'}`
    : !lastEmailSuccess
    ? 'Asnjë backup nuk është dërguar ende me email.'
    : Date.now() - new Date(lastEmailSuccess).getTime() > EMAIL_STALE_MS
    ? `Email-i i fundit i suksesshëm është më i vjetër se 8 ditë (${formatDateTime(lastEmailSuccess)}).`
    : null
  const failureIsCurrent =
    status?.lastFailure != null && (!latest || status.lastFailure.at > latest.createdAt)

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/backups', { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res, 'Backup-i dështoi'))
      toast.success('Backup-i u krijua')
      await fetchStatus()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Backup-i dështoi')
    } finally {
      setCreating(false)
    }
  }

  const handleEmail = async () => {
    setEmailing(true)
    try {
      const res = await fetch('/api/backups/email', { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res, 'Dërgimi i email-it dështoi'))
      toast.success('Backup-i u dërgua në email')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dërgimi i email-it dështoi')
    } finally {
      setEmailing(false)
      await fetchStatus()
    }
  }

  const handleDownload = async (snapshot: Snapshot) => {
    try {
      const res = await fetch(`/api/backups/download?path=${encodeURIComponent(snapshot.path)}`)
      if (!res.ok) throw new Error(await readError(res, 'Shkarkimi dështoi'))
      const { url } = await res.json()
      window.location.href = url
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Shkarkimi dështoi')
    }
  }

  const openRestore = async (snapshot: Snapshot) => {
    setRestoreTarget(snapshot)
    setPreview(null)
    setPreviewError(null)
    setConfirmText('')
    setRestoreResult(null)
    try {
      const res = await fetch(`/api/backups/preview?path=${encodeURIComponent(snapshot.path)}`)
      if (!res.ok) throw new Error(await readError(res, 'Krahasimi dështoi'))
      setPreview(await res.json())
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Krahasimi dështoi')
    }
  }

  const closeRestore = () => {
    if (restoring) return
    setRestoreTarget(null)
  }

  const handleRestore = async () => {
    if (!restoreTarget || confirmText !== CONFIRM_WORD) return
    setRestoring(true)
    try {
      const res = await fetch('/api/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: restoreTarget.path, mode: 'restore', confirm: confirmText }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Rikthimi dështoi'))
      const result: RestoreResult = await res.json()
      setRestoreResult(result)
      toast.success(result.verified ? 'Të dhënat u rikthyen' : 'U rikthye, por verifikimi ka mospërputhje')
      await fetchStatus()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rikthimi dështoi')
    } finally {
      setRestoring(false)
    }
  }

  const runDryRun = async (snapshot: Snapshot) => {
    setDryRunTarget(snapshot)
    setDryRun(null)
    setDryRunError(null)
    try {
      const res = await fetch('/api/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: snapshot.path, mode: 'dry-run' }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Prova dështoi'))
      setDryRun(await res.json())
    } catch (error) {
      setDryRunError(error instanceof Error ? error.message : 'Prova dështoi')
    }
  }

  const postUpload = async (file: File, mode: 'preview' | 'dry-run' | 'restore', confirm?: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('mode', mode)
    if (confirm) form.append('confirm', confirm)
    const res = await fetch('/api/backups/upload', { method: 'POST', body: form })
    if (!res.ok) throw new Error(await readError(res, 'Kërkesa dështoi'))
    return res.json()
  }

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file again still fires
    if (!file) return
    setUploadFile(file)
    setUploadStep('checking')
    setUploadPreview(null)
    setUploadDryRun(null)
    setUploadResult(null)
    setUploadConfirm('')
    setUploadError(null)
    if (!/\.json\.gz$/i.test(file.name)) {
      setUploadError('Skedari duhet të jetë .json.gz (i shkarkuar nga “Shkarko” ose nga email-i).')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError('Skedari është më i madh se 4 MB.')
      return
    }
    try {
      setUploadPreview(await postUpload(file, 'preview'))
      setUploadStep('checked')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Kontrolli i skedarit dështoi')
    }
  }

  const runUploadDryRun = async () => {
    if (!uploadFile) return
    setUploadStep('dry-running')
    setUploadError(null)
    try {
      setUploadDryRun(await postUpload(uploadFile, 'dry-run'))
      setUploadStep('dry-run')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Prova dështoi')
      setUploadStep('checked')
    }
  }

  // Offered only after a passing dry run of this same file.
  const runUploadRestore = async () => {
    if (!uploadFile || uploadConfirm !== CONFIRM_WORD || !uploadDryRun?.ok) return
    setUploadStep('restoring')
    setUploadError(null)
    try {
      const result: RestoreResult = await postUpload(uploadFile, 'restore', uploadConfirm)
      setUploadResult(result)
      setUploadStep('restored')
      toast.success(result.verified ? 'Të dhënat u rikthyen' : 'U rikthye, por verifikimi ka mospërputhje')
      await fetchStatus()
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Rikthimi dështoi')
      setUploadStep('dry-run')
    }
  }

  const closeUpload = () => {
    if (uploadStep === 'dry-running' || uploadStep === 'restoring') return
    setUploadFile(null)
  }

  if (!role || role !== 'admin') return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Backup & Rikthim"
        subtitle="Kopje automatike të të gjitha të dhënave, me mundësi rikthimi në çdo pikë"
        action={
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".gz,application/gzip"
              className="hidden"
              onChange={handleFilePicked}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={!status?.configured}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <RiUploadLine />
              Ngarko backup
            </button>
            <button
              onClick={handleEmail}
              disabled={emailing || !status?.configured || !status?.emailConfigured}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <RiMailSendLine />
              {emailing ? 'Duke dërguar...' : 'Dërgo tani në email'}
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !status?.configured}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              <RiSaveLine />
              {creating ? 'Duke ruajtur...' : 'Bëj backup tani'}
            </button>
          </div>
        }
      />

      {status && !status.configured && (
        <div className="card p-4 mb-6 border-red-200 bg-red-50 flex gap-3">
          <RiAlertLine className="text-red-500 text-xl flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">
            <p className="font-semibold">Backup-et nuk janë aktive</p>
            <p>{status.problem}</p>
          </div>
        </div>
      )}

      {failureIsCurrent && status?.lastFailure && (
        <div className="card p-4 mb-6 border-amber-200 bg-amber-50 flex gap-3">
          <RiAlertLine className="text-amber-500 text-xl flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">
              Backup-i i fundit dështoi më {formatDateTime(status.lastFailure.at)}
            </p>
            <p className="break-words">{status.lastFailure.message}</p>
            <p className="text-xs mt-1 text-amber-700">
              Shitjet vazhdojnë normalisht. Backup-i i suksesshëm i radhës e heq këtë paralajmërim.
            </p>
          </div>
        </div>
      )}

      {emailProblem && (
        <div className="card p-4 mb-6 border-amber-200 bg-amber-50 flex gap-3">
          <RiAlertLine className="text-amber-500 text-xl flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold break-words">{emailProblem}</p>
            <p className="text-xs mt-1 text-amber-700">
              Deri sa të rregullohet, shtyp “Shkarko” te backup-i i fundit dhe ruaje skedarin
              diku jashtë (USB, Google Drive).
            </p>
          </div>
        </div>
      )}

      {status?.configured && (
        <div className="card p-4 mb-6 text-sm text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
          <span>
            Backup-i i fundit:{' '}
            <strong className="text-slate-800">{latest ? formatDateTime(latest.createdAt) : 'asnjë'}</strong>
          </span>
          <span>
            Gjithsej: <strong className="text-slate-800">{status.total ?? status.snapshots.length}</strong>
          </span>
          <span>
            Email-i i fundit:{' '}
            <strong className="text-slate-800">
              {lastEmailSuccess ? formatDateTime(lastEmailSuccess) : 'asnjë'}
            </strong>
          </span>
          <span className="text-slate-400">
            Ruhen të gjitha për 48 orë, pastaj një në orë deri në 7 ditë, një në ditë deri në 30 ditë.
          </span>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading && !status ? (
          <div className="p-8 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Duke ngarkuar backup-et...</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="p-12 text-center">
            <RiDatabase2Line className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">Nuk ka backup akoma</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">Ora</th>
                  <th className="table-th">Lloji</th>
                  <th className="table-th">Rreshta</th>
                  <th className="table-th">Madhësia</th>
                  <th className="table-th text-right">Veprime</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([day, snapshots]) => (
                  <DayGroup
                    key={day}
                    snapshots={snapshots}
                    onDownload={handleDownload}
                    onDryRun={runDryRun}
                    onRestore={openRestore}
                  />
                ))}
              </tbody>
            </table>
            {status && (status.total ?? 0) > status.snapshots.length && (
              <div className="p-4 text-center border-t border-slate-100">
                <button onClick={() => setShowAll(true)} className="btn-secondary">
                  Shfaq të gjitha ({status.total})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Restore */}
      <Modal
        isOpen={restoreTarget !== null}
        onClose={closeRestore}
        title={restoreTarget ? `Rikthe te ${formatDateTime(restoreTarget.createdAt)}` : ''}
        size="lg"
      >
        {restoreResult ? (
          <div className="space-y-4 text-sm">
            <p className={restoreResult.verified ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
              {restoreResult.verified
                ? 'Rikthimi përfundoi dhe numri i rreshtave u verifikua.'
                : 'Rikthimi përfundoi, por verifikimi pas tij gjeti mospërputhje.'}
            </p>
            <CountsTable
              columns={['Para', 'Pas']}
              tables={tableNames(restoreResult.before, restoreResult.after)}
              values={[restoreResult.before, restoreResult.after]}
            />
            <p className="text-slate-500">
              Gjendja e mëparshme u ruajt si snapshot “Para rikthimit” ({formatDateTime(restoreResult.preRestore.createdAt)}),
              që mund ta rikthesh po ashtu.
            </p>
            <button onClick={() => setRestoreTarget(null)} className="btn-secondary w-full">
              Mbyll
            </button>
          </div>
        ) : previewError ? (
          <p className="text-sm text-red-600">{previewError}</p>
        ) : !preview ? (
          <p className="text-sm text-slate-400">Duke krahasuar me gjendjen aktuale...</p>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              Të gjitha të dhënat e dyqanit do të zëvendësohen me ato të këtij snapshot-i. Ndryshimet pas{' '}
              {formatDateTime(preview.createdAt)} do të hiqen. Llogaritë e hyrjes nuk preken.
            </p>
            <CountsTable
              columns={['Tani', 'Në snapshot']}
              tables={tableNames(preview.current, preview.snapshot)}
              values={[preview.current, preview.snapshot]}
              showDiff
            />
            <p className="text-slate-500">{ADMIN_ACTION_LABELS[preview.adminAction]}</p>
            <p className="text-slate-500">
              Para rikthimit ruhet automatikisht një snapshot i gjendjes aktuale.
            </p>

            {preview.problems.length > 0 ? (
              <div className="rounded-lg bg-red-50 p-3 text-red-700">
                <p className="font-semibold mb-1">Ky snapshot nuk mund të rikthehet:</p>
                <ul className="list-disc pl-5">
                  {preview.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <div>
                  <label className="label">
                    Shkruaj <strong>{CONFIRM_WORD}</strong> për të konfirmuar
                  </label>
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="input"
                    autoComplete="off"
                    disabled={restoring}
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={closeRestore} disabled={restoring} className="btn-secondary flex-1">
                    Anulo
                  </button>
                  <button
                    onClick={handleRestore}
                    disabled={confirmText !== CONFIRM_WORD || restoring}
                    className="btn-danger flex-1 disabled:opacity-50"
                  >
                    {restoring ? 'Duke rikthyer...' : 'Rikthe'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Ngarko backup: check → dry run → RIKTHE */}
      <Modal
        isOpen={uploadFile !== null}
        onClose={closeUpload}
        title={uploadFile ? `Ngarko backup — ${uploadFile.name}` : ''}
        size="lg"
      >
        <div className="space-y-4 text-sm">
          {uploadStep === 'checking' && !uploadError && (
            <p className="text-slate-400">Duke kontrolluar skedarin...</p>
          )}

          {uploadPreview && uploadStep !== 'restored' && (
            <>
              <p className="text-slate-600">
                Snapshot nga <strong>{formatDateTime(uploadPreview.createdAt)}</strong>
                {KIND_LABELS[uploadPreview.kind as Kind] && (
                  <> · {KIND_LABELS[uploadPreview.kind as Kind].label}</>
                )}
                . Krahasuar me të dhënat e tanishme:
              </p>
              <CountsTable
                columns={['Tani', 'Në skedar']}
                tables={tableNames(uploadPreview.current, uploadPreview.snapshot)}
                values={[uploadPreview.current, uploadPreview.snapshot]}
                showDiff
              />
              {uploadPreview.problems.length > 0 ? (
                <div className="rounded-lg bg-red-50 p-3 text-red-700">
                  <p className="font-semibold mb-1">Ky skedar nuk mund të rikthehet:</p>
                  <ul className="list-disc pl-5">
                    {uploadPreview.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-emerald-700">
                  ✓ Formati, tabelat dhe kolonat përputhen me skemën aktuale.
                </p>
              )}
            </>
          )}

          {uploadDryRun && uploadStep !== 'restored' && (
            <div className="border-t border-slate-100 pt-4">
              <p className="font-semibold text-slate-800 mb-2">Prova (dry run)</p>
              <DryRunReport dryRun={uploadDryRun} />
            </div>
          )}

          {uploadError && <p className="text-red-600 break-words">{uploadError}</p>}

          {uploadPreview && uploadPreview.problems.length === 0 && !uploadDryRun && (
            <div className="flex gap-3">
              <button onClick={closeUpload} disabled={uploadStep === 'dry-running'} className="btn-secondary flex-1">
                Anulo
              </button>
              <button
                onClick={runUploadDryRun}
                disabled={uploadStep === 'dry-running'}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <RiFlaskLine />
                {uploadStep === 'dry-running' ? 'Duke provuar...' : 'Bëj provën (dry run)'}
              </button>
            </div>
          )}

          {uploadDryRun?.ok && uploadStep !== 'restored' && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-slate-600">
                Rikthimi zëvendëson të gjitha të dhënat e dyqanit me ato të skedarit. Para tij ruhet
                automatikisht një snapshot “Para rikthimit”. Llogaritë e hyrjes nuk preken.
              </p>
              <p className="text-slate-500">{ADMIN_ACTION_LABELS[uploadDryRun.adminAction]}</p>
              <div>
                <label className="label">
                  Shkruaj <strong>{CONFIRM_WORD}</strong> për të konfirmuar
                </label>
                <input
                  value={uploadConfirm}
                  onChange={(e) => setUploadConfirm(e.target.value)}
                  className="input"
                  autoComplete="off"
                  disabled={uploadStep === 'restoring'}
                />
              </div>
              <div className="flex gap-3">
                <button onClick={closeUpload} disabled={uploadStep === 'restoring'} className="btn-secondary flex-1">
                  Anulo
                </button>
                <button
                  onClick={runUploadRestore}
                  disabled={uploadConfirm !== CONFIRM_WORD || uploadStep === 'restoring'}
                  className="btn-danger flex-1 disabled:opacity-50"
                >
                  {uploadStep === 'restoring' ? 'Duke rikthyer...' : 'Rikthe nga skedari'}
                </button>
              </div>
            </div>
          )}

          {uploadResult && (
            <>
              <p className={uploadResult.verified ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                {uploadResult.verified
                  ? 'Rikthimi përfundoi dhe numri i rreshtave u verifikua.'
                  : 'Rikthimi përfundoi, por verifikimi pas tij gjeti mospërputhje.'}
              </p>
              <CountsTable
                columns={['Para', 'Pas']}
                tables={tableNames(uploadResult.before, uploadResult.after)}
                values={[uploadResult.before, uploadResult.after]}
              />
              <p className="text-slate-500">
                Gjendja e mëparshme u ruajt si snapshot “Para rikthimit” (
                {formatDateTime(uploadResult.preRestore.createdAt)}), që mund ta rikthesh po ashtu.
              </p>
              <button onClick={closeUpload} className="btn-secondary w-full">
                Mbyll
              </button>
            </>
          )}
        </div>
      </Modal>

      {/* Dry run */}
      <Modal
        isOpen={dryRunTarget !== null}
        onClose={() => setDryRunTarget(null)}
        title={dryRunTarget ? `Provë rikthimi — ${formatDateTime(dryRunTarget.createdAt)}` : ''}
        size="lg"
      >
        {dryRunError ? (
          <p className="text-sm text-red-600">{dryRunError}</p>
        ) : !dryRun ? (
          <p className="text-sm text-slate-400">
            Duke rikthyer në skemën e përkohshme restore_test... Tabelat reale nuk preken.
          </p>
        ) : (
          <DryRunReport dryRun={dryRun} />
        )}
      </Modal>
    </div>
  )
}

function DayGroup({
  snapshots,
  onDownload,
  onDryRun,
  onRestore,
}: {
  snapshots: Snapshot[]
  onDownload: (s: Snapshot) => void
  onDryRun: (s: Snapshot) => void
  onRestore: (s: Snapshot) => void
}) {
  return (
    <>
      <tr className="bg-slate-50/60">
        <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-slate-500 capitalize">
          {formatDay(snapshots[0].createdAt)}
        </td>
      </tr>
      {snapshots.map((s) => (
        <tr key={s.path} className="table-row">
          <td className="table-td font-mono text-slate-700 whitespace-nowrap">{formatTime(s.createdAt)}</td>
          <td className="table-td">
            <span className={KIND_LABELS[s.kind]?.className ?? 'badge-gray'}>
              {KIND_LABELS[s.kind]?.label ?? s.kind}
            </span>
          </td>
          <td className="table-td text-xs text-slate-500">
            {tableNames(s.rowCounts)
              .map((t) => `${label(t)} ${s.rowCounts[t]}`)
              .join(' · ')}
          </td>
          <td className="table-td text-xs text-slate-400 whitespace-nowrap">{formatSize(s.size)}</td>
          <td className="table-td">
            <div className="flex justify-end gap-1.5 whitespace-nowrap">
              <button onClick={() => onDownload(s)} className="btn-secondary text-xs px-2 py-1 flex items-center gap-1">
                <RiDownloadLine /> Shkarko
              </button>
              <button onClick={() => onDryRun(s)} className="btn-secondary text-xs px-2 py-1 flex items-center gap-1">
                <RiFlaskLine /> Provë (dry run)
              </button>
              <button onClick={() => onRestore(s)} className="btn-danger text-xs px-2 py-1 flex items-center gap-1">
                <RiHistoryLine /> Rikthe këtu
              </button>
            </div>
          </td>
        </tr>
      ))}
    </>
  )
}

function CountsTable({
  columns,
  tables,
  values,
  showDiff = false,
}: {
  columns: string[]
  tables: string[]
  values: Record<string, number>[]
  showDiff?: boolean
}) {
  return (
    <table className="w-full border border-slate-100 rounded-lg overflow-hidden">
      <thead className="bg-slate-50">
        <tr>
          <th className="table-th">Tabela</th>
          {columns.map((c) => (
            <th key={c} className="table-th text-right">
              {c}
            </th>
          ))}
          {showDiff && <th className="table-th text-right">Ndryshimi</th>}
        </tr>
      </thead>
      <tbody>
        {tables.map((t) => {
          const diff = (values[1]?.[t] ?? 0) - (values[0]?.[t] ?? 0)
          const differs = values.some((v) => v[t] !== values[0][t])
          return (
            <tr key={t} className="border-t border-slate-100">
              <td className="table-td">{label(t)}</td>
              {values.map((v, i) => (
                <td key={i} className={`table-td text-right font-mono ${differs ? 'text-slate-900' : 'text-slate-500'}`}>
                  {v[t] ?? '—'}
                </td>
              ))}
              {showDiff && (
                <td
                  className={`table-td text-right font-mono ${
                    diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-300'
                  }`}
                >
                  {diff > 0 ? `+${diff}` : diff}
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DryRunReport({ dryRun }: { dryRun: DryRun }) {
  return (
    <div className="space-y-4 text-sm">
      <p className={dryRun.ok ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
        {dryRun.ok
          ? 'Prova kaloi: ky snapshot mund të rikthehet.'
          : 'Prova gjeti probleme — mos e rikthe këtë snapshot pa i kontrolluar.'}
      </p>
      <CountsTable
        columns={['Në snapshot', 'Pritet', 'U rikthye']}
        tables={tableNames(dryRun.snapshot, dryRun.restored)}
        values={[dryRun.snapshot, dryRun.expected, dryRun.restored]}
      />
      <ul className="space-y-1 text-slate-600">
        <Check ok={dryRun.countsMatch} text="Numri i rreshtave përputhet" />
        <Check ok={dryRun.sequencesOk} text="Sekuencat e ID-ve janë pas ID-së më të madhe" />
        <Check ok={dryRun.schemaDropped} text="Skema restore_test u fshi" />
        <Check
          ok={dryRun.publicUnchanged}
          text={
            dryRun.publicUnchanged
              ? 'Tabelat reale nuk ndryshuan'
              : 'Tabelat reale ndryshuan gjatë provës (shitje të reja?)'
          }
        />
      </ul>
      <p className="text-slate-500">{ADMIN_ACTION_LABELS[dryRun.adminAction]}</p>
    </div>
  )
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={ok ? 'text-emerald-700' : 'text-red-700'}>
      {ok ? '✓' : '✗'} {text}
    </li>
  )
}
