'use client'

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { RiSearchLine, RiBarcodeLine, RiCloseLine } from 'react-icons/ri'
import { cn } from '@/lib/utils'

export interface SearchInputHandle {
  focus: () => void
  clear: () => void
}

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Called on Enter with the trimmed value, when it is non-empty. */
  onSubmit?: (value: string) => void
  /** Barcode style: monospace, no autocorrect, barcode icon. */
  variant?: 'search' | 'barcode'
  autoFocus?: boolean
  disabled?: boolean
  className?: string
  inputClassName?: string
  /** Replaces the default left icon. */
  icon?: React.ReactNode
  /** Transient scan feedback. Colours the border/background; × stays usable. */
  tone?: 'neutral' | 'success' | 'error'
  /**
   * Scan-replace: select the whole value on focus and after Enter, so the next
   * scan overwrites it instead of appending. For fields that keep their value
   * after a scan; fields that clear themselves don't need it.
   */
  selectOnScan?: boolean
  'aria-label'?: string
  id?: string
}

/**
 * Search / barcode field with a clear (×) button.
 *
 * Clearing — by the × or by Escape — always returns focus to the input, so a
 * scanner can fire again immediately without anyone touching the mouse.
 */
const SearchInput = forwardRef<SearchInputHandle, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    placeholder,
    onSubmit,
    variant = 'search',
    autoFocus,
    disabled,
    className,
    inputClassName,
    icon,
    tone = 'neutral',
    selectOnScan,
    'aria-label': ariaLabel,
    id,
  },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isBarcode = variant === 'barcode'

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => {
      onChange('')
      inputRef.current?.focus()
    },
  }))

  function clear() {
    onChange('')
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      // Keep focus: Escape is a correction mid-scan, not an exit.
      clear()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = value.trim()
      if (trimmed && onSubmit) onSubmit(trimmed)
      if (selectOnScan) inputRef.current?.select()
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLInputElement>) {
    // A click would place the caret after onFocus selected everything, so take
    // the focusing click over. Clicks on an already-focused field behave
    // normally, which keeps manual editing possible.
    if (selectOnScan && document.activeElement !== inputRef.current) {
      e.preventDefault()
      inputRef.current?.focus()
    }
  }

  const toneInput =
    tone === 'success'
      ? 'border-green-400 bg-green-50 text-green-800 placeholder-green-300'
      : tone === 'error'
      ? 'border-red-400 bg-red-50 text-red-800 placeholder-red-300'
      : ''
  const toneIcon =
    tone === 'success' ? 'text-green-500' : tone === 'error' ? 'text-red-400' : 'text-slate-400'

  return (
    <div className={cn('relative', className)}>
      <span
        className={cn(
          'absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200',
          toneIcon
        )}
      >
        {icon ?? (isBarcode ? <RiBarcodeLine className="text-lg" /> : <RiSearchLine />)}
      </span>

      <input
        id={id}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={selectOnScan ? (e) => e.currentTarget.select() : undefined}
        onMouseDown={handleMouseDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          'input pl-10 transition-colors duration-200',
          value ? 'pr-10' : 'pr-3',
          isBarcode && 'font-mono',
          toneInput,
          inputClassName
        )}
      />

      {value && !disabled && (
        <button
          type="button"
          onClick={clear}
          tabIndex={-1}
          aria-label="Pastro"
          title="Pastro (Esc)"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <RiCloseLine className="text-base" />
        </button>
      )}
    </div>
  )
})

export default SearchInput
