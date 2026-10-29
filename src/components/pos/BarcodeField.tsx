'use client'

import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { RiBarcodeLine, RiCheckLine } from 'react-icons/ri'
import SearchInput, { type SearchInputHandle } from '@/components/ui/SearchInput'
import { usePresence } from '@/lib/animation'
import { findProducts, searchIndex } from '@/lib/product-search'
import type { CatalogProduct } from '@/lib/catalog-shape'

export type ScanTone = 'success' | 'error'

export interface BarcodeFieldHandle {
  focus: () => void
  /** Empties the field (and the search), without moving focus. */
  clear: () => void
  /** Colours the field and shows `message` for `duration` ms. */
  flash: (tone: ScanTone, message: string, duration: number) => void
  /** Neutral message with no timeout, e.g. "Duke kërkuar..." during a lookup. */
  notice: (message: string) => void
}

interface BarcodeFieldProps {
  /** Enter with digits or a cached barcode: exact barcode lookup. */
  onScan: (code: string) => void
  /** Enter with text that matches exactly one product. */
  onPick: (product: CatalogProduct) => void
  /** The search text for the grid, after a pause in typing; '' at once when cleared. */
  onQuery: (query: string) => void
  /** The cached catalogue, to count matches on Enter. */
  products: CatalogProduct[]
  /** Exact barcode match against the cache (no network). */
  findByBarcode: (code: string) => CatalogProduct | undefined
}

/**
 * How long typing must pause before the grid filters. A scanner types a code
 * and Enter within a few ms, so a scan never gets this far: Enter clears the
 * field first and the grid never sees the digits.
 */
const QUERY_PAUSE_MS = 200

/**
 * The POS field: scan a barcode or search products, in one input.
 *
 * Isolated from the page. A scanner types ~13 characters and Enter in a
 * burst; when the typed value lived in the POS page, every character
 * re-rendered the whole page. The value, the flash colour and the message
 * live here, so a keystroke re-renders only this component. The page hears
 * the text only through `onQuery`, after QUERY_PAUSE_MS without a keystroke.
 *
 * Enter:
 *   1. a barcode in the cache → `onScan` (instant, as before);
 *   2. only digits → `onScan`, which asks the server ("Duke kërkuar...") and
 *      says "Produkti nuk u gjet" on a miss — never a prefix guess;
 *   3. text with letters matching exactly one product → `onPick`;
 *   4. otherwise nothing is added: the text stays and the matching tiles show,
 *      so the cashier clicks one.
 * Enter reads the DOM value (SearchInput passes `e.currentTarget.value`), so a
 * scan never waits for state.
 *
 * Every prop must be stable or change only with the catalogue (memoised).
 */
const BarcodeField = memo(
  forwardRef<BarcodeFieldHandle, BarcodeFieldProps>(function BarcodeField(
    { onScan, onPick, onQuery, products, findByBarcode },
    ref
  ) {
    const [value, setValue] = useState('')
    const [tone, setTone] = useState<ScanTone | null>(null)
    const [message, setMessage] = useState('')
    const inputRef = useRef<SearchInputHandle>(null)
    // One timer, so an earlier scan's timeout can't wipe a newer message.
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const index = useMemo(() => searchIndex(products), [products])

    // The grid filters only once typing pauses; an empty field clears at once.
    useEffect(() => {
      if (queryTimer.current) clearTimeout(queryTimer.current)
      if (value.trim() === '') {
        onQuery('')
        return
      }
      queryTimer.current = setTimeout(() => onQuery(value), QUERY_PAUSE_MS)
    }, [value, onQuery])

    // The message keeps its text and colour while it fades out.
    const presence = usePresence(!!message, 300)
    const shown = useRef<{ text: string; tone: ScanTone | null }>({ text: '', tone: null })
    if (message) shown.current = { text: message, tone }

    useEffect(() => () => {
      if (timer.current) clearTimeout(timer.current)
      if (queryTimer.current) clearTimeout(queryTimer.current)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        clear: () => setValue(''),
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
      if (findByBarcode(code) || /^\d+$/.test(code)) {
        // Clear at once so the next scan can start straight away.
        setValue('')
        onScan(code)
        return
      }
      const matches = findProducts(index, code, 2)
      if (matches.length === 1) {
        setValue('')
        onPick(matches[0])
        return
      }
      // Several or none: show them now rather than after the pause.
      if (queryTimer.current) clearTimeout(queryTimer.current)
      onQuery(code)
    }

    return (
      <div>
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
