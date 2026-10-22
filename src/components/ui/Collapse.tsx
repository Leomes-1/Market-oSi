'use client'

import { usePresence } from '@/lib/animation'

/**
 * Expands to its content's height and fades in; collapses and fades out
 * before unmounting. CSS only: animating grid rows 0fr ↔ 1fr reaches the
 * natural height without measuring it.
 */
export default function Collapse({
  open,
  className = '',
  children,
}: {
  open: boolean
  className?: string
  children: React.ReactNode
}) {
  const { mounted, phase } = usePresence(open, 300)
  if (!mounted) return null
  const shown = phase === 'entered'

  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
        shown ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className={`min-h-0 overflow-hidden ${className}`}>{children}</div>
    </div>
  )
}
