'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { RiSearchLine, RiBarcodeLine, RiCloseLine } from 'react-icons/ri'
import { cn } from '@/lib/utils'

/** Mouse/trackpad as the primary pointer — i.e. not a phone or tablet. */
function isDesktopPointer() {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches
  } catch {
    return false
  }
}

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
  /**
   * Focus the field when it mounts, so a scan works without clicking it
   * first. `true` does this on desktop only (a fine pointer), so opening a
   * page on a phone doesn't pop the keyboard; 'always' focuses everywhere.
   */
  autoFocus?: boolean | 'always'
  disabled?: boolean
  className?: string
  inputClassName?: string
  /** Replaces the default left icon. */
  icon?: React.ReactNode
  /** Transient scan feedback. Colours the border/background; × stays usable. */
  tone?: 'neutral' | 'success' | 'error'
  /**
   * Scan-replace: after Enter the value stays visible (not selected), and the
   * first character typed or pasted after it replaces the whole value instead
   * of appending, so the next scan starts clean. Clicking the field or moving
   * the caret cancels that and edits normally. For fields that keep their
   * value after a scan; fields that clear themselves don't need it.
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
  // Set by Enter on a selectOnScan field: the next character replaces the value.
  const replaceNext = useRef(false)

  useEffect(() => {
    if (!autoFocus) return
    if (autoFocus === 'always' || isDesktopPointer()) inputRef.current?.focus()
    // Mount only: re-focusing on later renders would steal focus from other fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => {
      replaceNext.current = false
      onChange('')
      inputRef.current?.focus()
    },
  }))

  function clear() {
    replaceNext.current = false
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
      // Read the field itself, not the `value` prop: a scanner types the code
      // and Enter in one burst, and the DOM always has every character.
      const trimmed = e.currentTarget.value.trim()
      if (trimmed && onSubmit) onSubmit(trimmed)
      if (selectOnScan) replaceNext.current = true
      return
    }
    if (!replaceNext.current) return

    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
    if (printable) {
      // First character after a scan: start the value over with it.
      e.preventDefault()
      replaceNext.current = false
      onChange(e.key)
    } else if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) {
      // Backspace, arrows, Home/End… mean the operator is editing by hand.
      replaceNext.current = false
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (!replaceNext.current) return
    e.preventDefault()
    replaceNext.current = false
    onChange(e.clipboardData.getData('text'))
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
        onPaste={handlePaste}
        // A click means the operator wants to edit what is there.
        onMouseDown={() => { replaceNext.current = false }}
        placeholder={placeholder}
        disabled={disabled}
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
