import { tracksStock } from './validation'

export function formatCurrency(amount: number): string {
  return `${amount.toFixed(0)} L`
}

export function formatDate(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleDateString('sq-AL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleString('sq-AL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleTimeString('sq-AL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Products whose stock is not tracked (see `tracksStock`) are never low. */
export function isLowStock(sasia: number, stokuMinimal: number, njesia?: string): boolean {
  if (!tracksStock(njesia)) return false
  return sasia <= stokuMinimal
}

/**
 * Margin as a percentage of revenue — profit / revenue.
 *
 * The app previously computed this two different ways: the product form used
 * profit / cost (a markup), while the dashboard and the exports used
 * profit / revenue. Both were labelled "marzh" and disagreed. This is the one
 * definition, and it returns null rather than Infinity or NaN when there is
 * nothing to divide by.
 */
export function marginPercent(fitimi: number, totali: number): number | null {
  if (!Number.isFinite(fitimi) || !Number.isFinite(totali) || totali === 0) return null
  return (fitimi / totali) * 100
}

/** Renders a percentage, showing an em dash when the value is undefined. */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function toArray<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[]
  if (key && data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)[key])) {
    return (data as Record<string, unknown>)[key] as T[]
  }
  return []
}
