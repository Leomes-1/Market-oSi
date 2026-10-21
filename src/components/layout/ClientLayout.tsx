'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { RiMenuLine, RiStore2Line } from 'react-icons/ri'
import Sidebar from './Sidebar'
import { RoleProvider } from '@/contexts/RoleContext'
import { Role } from '@/lib/roles'

const POS_SIDEBAR_KEY = 'pos.cashierSidebarOpen'

interface DesktopSidebarToggle {
  /** True only where the desktop sidebar can be hidden: a cashier on the POS. */
  collapsible: boolean
  open: boolean
  toggle: () => void
}

const DesktopSidebarContext = createContext<DesktopSidebarToggle>({
  collapsible: false,
  open: true,
  toggle: () => {},
})

/** Lets a page render the desktop sidebar toggle where it fits its header. */
export function useDesktopSidebar() {
  return useContext(DesktopSidebarContext)
}

export default function ClientLayout({
  children,
  role,
}: {
  children: React.ReactNode
  role: Role | null
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Cashiers on the POS get the full width: their desktop sidebar starts
  // closed and remembers whether they opened it. Every other role and page
  // keeps the static sidebar.
  const collapsible = role === 'cashier' && pathname === '/shitjet'
  const [posSidebarOpen, setPosSidebarOpen] = useState(false)

  useEffect(() => {
    try {
      setPosSidebarOpen(localStorage.getItem(POS_SIDEBAR_KEY) === '1')
    } catch {
      // Storage blocked — stay closed.
    }
  }, [])

  function togglePosSidebar() {
    setPosSidebarOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(POS_SIDEBAR_KEY, next ? '1' : '0')
      } catch {
        // Storage blocked — the choice just won't be remembered.
      }
      return next
    })
  }

  const desktopHidden = collapsible && !posSidebarOpen

  if (pathname === '/login') {
    return <RoleProvider role={role}>{children}</RoleProvider>
  }

  return (
    <RoleProvider role={role}>
      <DesktopSidebarContext.Provider
        value={{ collapsible, open: !desktopHidden, toggle: togglePosSidebar }}
      >
        <div className="flex h-screen overflow-hidden bg-slate-50">
          {/* Mobile backdrop */}
          {open && (
            <div
              className="fixed inset-0 z-20 bg-black/40 lg:hidden"
              onClick={() => setOpen(false)}
            />
          )}

          {/* Sidebar — slides in on mobile, static on desktop */}
          <div
            className={`fixed inset-y-0 left-0 z-30 lg:static lg:translate-x-0 transition-transform duration-300 ease-in-out ${
              open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
            } ${desktopHidden ? 'lg:hidden' : ''}`}
          >
            <Sidebar onClose={() => setOpen(false)} />
          </div>

          {/* Right side: top bar + page content */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {/* Mobile-only top bar */}
            <header className="lg:hidden flex items-center gap-3 h-14 px-4 bg-white border-b border-slate-200 flex-shrink-0">
              <button
                onClick={() => setOpen(true)}
                className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="Hap menunë"
              >
                <RiMenuLine className="text-xl" />
              </button>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
                  <RiStore2Line className="text-white text-sm" />
                </div>
                <span className="font-bold text-slate-900">Market OS</span>
              </div>
            </header>

            <main className="flex-1 overflow-y-auto min-h-0">
              {children}
            </main>
          </div>
        </div>
      </DesktopSidebarContext.Provider>
    </RoleProvider>
  )
}
