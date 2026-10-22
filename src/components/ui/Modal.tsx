'use client'

import { useRef } from 'react'
import { usePresence } from '@/lib/animation'
import { RiCloseLine } from 'react-icons/ri'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  // Kept mounted for the 180 ms exit, as AnimatePresence did.
  const { mounted, phase } = usePresence(isOpen, 180)
  // While closing, show what was there when it was open: callers usually
  // clear the content in the same update that closes the modal.
  const last = useRef({ title, children })
  if (isOpen) last.current = { title, children }
  if (!mounted) return null
  const shown = phase === 'entered'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-150 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`relative bg-white rounded-2xl shadow-xl w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col transition-[opacity,transform] duration-[180ms] ease-out ${
          shown ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.96] translate-y-2'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{last.current.title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <RiCloseLine className="text-xl" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {last.current.children}
        </div>
      </div>
    </div>
  )
}
