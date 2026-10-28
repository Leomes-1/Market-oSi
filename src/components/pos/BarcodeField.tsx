'use client'

import { forwardRef, memo, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { RiBarcodeLine, RiCheckLine } from 'react-icons/ri'
import SearchInput, { type SearchInputHandle } from '@/components/ui/SearchInput'
import { usePresence } from '@/lib/animation'
import { formatCurrency } from '@/lib/utils'
import { findProducts, searchIndex } from '@/lib/product-search'
import type { CatalogProduct } from '@/lib/catalog-shape'

export type ScanTone = 'success' | 'error'

export interface BarcodeFieldHandle {
  focus: () => void
  /** Colours the field and shows `message` for `duration` ms. */
  flash: (tone: ScanTone, message: string, duration: number) => void
  /** Neutral message with no timeout, e.g. "Duke kërkuar..." during a lookup. */
  notice: (message: string) => void
}

interface BarcodeFieldProps {
  /** Enter with a code: a cached barcode, or one to look up on the server. */
  onScan: (code: string) => void
  /** A product chosen from the dropdown. */
  onPick: (product: CatalogProduct) => void
  /** The cached catalogue, searched by name for the dropdown. */
  products: CatalogProduct[]
  /** Exact barcode match against the cache (no network). */
  findByBarcode: (code: string) => CatalogProduct | undefined
}

const MAX_RESULTS = 8

/**
 * The POS field: scan a barcode or search a product by name, in one input.
 *
 * Isolated from the page. A scanner types ~13 characters and Enter in a
 * burst; when the typed value lived in the POS page, every character
 * re-rendered the whole page. The value, the dropdown, the flash colour and
 * the message live here, so a keystroke re-renders only this component.
 *
 * Enter, in order:
 *   1. the text is a barcode in the cache → `onScan` (instant, as before);
 *   2. only digits → exact barcode only: `onScan`, which asks the server
 *      ("Duke kërkuar...") and says "Produkti nuk u gjet" on a miss. A barcode
 *      that merely starts with those digits is never added — unless the
 *      cashier chose it with ↑/↓ first;
 *   3. text with letters and the dropdown has matches → `onPick` the
 *      highlighted one;
 *   4. otherwise → `onScan`.
 * A click on a dropdown item always adds it.
 * Enter reads the DOM value (SearchInput passes `e.currentTarget.value`), so a
 * scan never waits for state.
 *
 * The dropdown is built from a deferred copy of the value, so a scanner burst
 * doesn't render it per character. Every prop must be stable or change only
 * with the catalogue (the field is memoised).
 */
const BarcodeField = memo(
  forwardRef<BarcodeFieldHandle, BarcodeFieldProps>(function BarcodeField(
    { onScan, onPick, products, findByBarcode },
    ref
  ) {
    const [value, setValue] = useState('')
    const [active, setActive] = useState(0)
    // Set by ↑/↓: the highlighted item was chosen on purpose, so Enter adds it
    // even when the text is only digits.
    const [chosen, setChosen] = useState(false)
    const [tone, setTone] = useState<ScanTone | null>(null)
    const [message, setMessage] = useState('')
    const inputRef = useRef<SearchInputHandle>(null)
    // One timer, so an earlier scan's timeout can't wipe a newer message.
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const index = useMemo(() => searchIndex(products), [products])
    const query = useDeferredValue(value)
    const results = useMemo(() => findProducts(index, query, MAX_RESULTS), [index, query])
    // A new query starts at the top of the list.
    useEffect(() => {
      setActive(0)
      setChosen(false)
    }, [query])
    const open = value !== '' && query !== '' && results.length > 0

    // The message keeps its text and colour while it fades out.
    const presence = usePresence(!!message, 300)
    const shown = useRef<{ text: string; tone: ScanTone | null }>({ text: '', tone: null })
    if (message) shown.current = { text: message, tone }

    useEffect(() => () => {
      if (timer.current) clearTimeout(timer.current)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        flash: (nextTone, text, duration) => {
          if (timer.current) clearTimeout(timer.current)
          setTone(nextTone)
          setMessage(text)
          timer.current = setTimeout(() => {
            setTone(null)
            setMessage('')
          }, duration)
        },
        notice: (text) => {
          if (timer.current) clearTimeout(timer.current)
          setTone(null)
          setMessage(text)
        },
      }),
      []
    )

    function submit(code: string) {
      // Clear at once so the next scan can start straight away.
      setValue('')
      if (findByBarcode(code)) {
        onScan(code)
        return
      }
      const onScreen = query === code && results.length > 0
      if (/^\d+$/.test(code)) {
        // Digits are a barcode: exact match only, never a prefix guess.
        if (chosen && onScreen) onPick(results[Math.min(active, results.length - 1)])
        else onScan(code)
        return
      }
      // The list on screen if it is for this text; else match now, since a
      // fast typist can press Enter before the deferred list catches up.
      const list = onScreen ? results : findProducts(index, code, MAX_RESULTS)
      if (list.length > 0) onPick(list[onScreen ? Math.min(active, list.length - 1) : 0])
      else onScan(code)
    }

    function pick(product: CatalogProduct) {
      setValue('')
      onPick(product)
      inputRef.current?.focus()
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      if (!open) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % results.length)
        setChosen(true)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + results.length) % results.length)
        setChosen(true)
      }
    }

    return (
      <div className="relative" onKeyDown={onKeyDown}>
        <SearchInput
          ref={inputRef}
          variant="barcode"
          value={value}
          onChange={setValue}
          onSubmit={submit}
          tone={tone ?? 'neutral'}
          autoFocus="always"
          placeholder="Skano barkodin ose kërko produktin..."
          aria-label="Skano barkodin ose kërko produktin"
          inputClassName="py-2.5 text-sm font-medium rounded-xl border-2"
          icon={
            tone === 'success' ? (
              <RiCheckLine className="text-xl" />
            ) : tone === 'error' ? (
              <span className="text-lg font-bold leading-none">✗</span>
            ) : (
              <RiBarcodeLine className="text-xl" />
            )
          }
        />
        {open && (
          <ul
            role="listbox"
            className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
          >
            {results.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                // Keep focus in the field; the click itself adds the product.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm ${
                  i === active ? 'bg-blue-50' : 'bg-white'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{p.emri}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {p.kategoria}
                    {p.barcodes[0] && <span className="font-mono"> · {p.barcodes[0]}</span>}
                  </p>
                </div>
                <span className="font-semibold text-slate-900 whitespace-nowrap">
                  {formatCurrency(p.cmimiShitjes)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {presence.mounted && (
          <p
            className={`text-xs mt-1.5 font-medium pl-1 transition-[opacity,transform] duration-300 ease-out ${
              presence.phase === 'entering'
                ? 'opacity-0 -translate-y-1'
                : presence.phase === 'leaving'
                ? 'opacity-0'
                : 'opacity-100'
            } ${
              shown.current.tone === 'success'
                ? 'text-green-600'
                : shown.current.tone === 'error'
                ? 'text-red-500'
                : 'text-slate-500'
            }`}
          >
            {shown.current.text}
          </p>
        )}
      </div>
    )
  })
)

export default BarcodeField
