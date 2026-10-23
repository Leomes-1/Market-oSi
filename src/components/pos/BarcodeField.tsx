'use client'

import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { RiBarcodeLine, RiCheckLine } from 'react-icons/ri'
import SearchInput, { type SearchInputHandle } from '@/components/ui/SearchInput'
import { usePresence } from '@/lib/animation'
import { countRender, markKey } from '@/lib/pos-debug'

export type ScanTone = 'success' | 'error'

export interface BarcodeFieldHandle {
  focus: () => void
  /** Colours the field and shows `message` for `duration` ms. */
  flash: (tone: ScanTone, message: string, duration: number) => void
  /** Neutral message with no timeout, e.g. "Duke kërkuar..." during a lookup. */
  notice: (message: string) => void
}

/**
 * The POS barcode field, isolated from the page.
 *
 * A scanner types ~13 characters and Enter in a burst. When the typed value
 * lived in the POS page, every character re-rendered the whole page. The
 * value, the flash colour and the message under the field now live here, so a
 * keystroke re-renders only this component. Enter hands the field's DOM value
 * (SearchInput reads `e.currentTarget.value`) to `onScan` synchronously — no
 * debounce, no waiting for state.
 *
 * `onScan` must be stable (the field is memoised).
 */
const BarcodeField = memo(
  forwardRef<BarcodeFieldHandle, { onScan: (code: string) => void }>(function BarcodeField({ onScan }, ref) {
    countRender('BarcodeField')
    const [value, setValue] = useState('')
    const [tone, setTone] = useState<ScanTone | null>(null)
    const [message, setMessage] = useState('')
    const inputRef = useRef<SearchInputHandle>(null)
    // One timer, so an earlier scan's timeout can't wipe a newer message.
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    return (
      <div>
        <SearchInput
          ref={inputRef}
          variant="barcode"
          value={value}
          onChange={(v) => {
            markKey()
            setValue(v)
          }}
          onSubmit={(code) => {
            // Clear at once so the next scan can start straight away.
            setValue('')
            onScan(code)
          }}
          tone={tone ?? 'neutral'}
          autoFocus="always"
          placeholder="Skano ose shkruaj barkodin..."
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
