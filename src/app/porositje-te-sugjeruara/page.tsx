'use client'

import { useEffect, useState } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import LowStockTab from '@/components/porositje/LowStockTab'
import ShoppingListTab from '@/components/porositje/ShoppingListTab'
import { RiAlertLine, RiShoppingCart2Line } from 'react-icons/ri'

type Tab = 'stok' | 'lista'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'stok', label: 'Stok i ulët', icon: <RiAlertLine /> },
  { key: 'lista', label: 'Lista e blerjeve', icon: <RiShoppingCart2Line /> },
]

/** `?tab=lista` opens the shopping list, so the phone can bookmark it. */
function tabFromUrl(): Tab {
  try {
    return new URLSearchParams(window.location.search).get('tab') === 'lista' ? 'lista' : 'stok'
  } catch {
    return 'stok'
  }
}

export default function PorositjeTeSugjeruaraPage() {
  const { role } = useRole()
  // Unknown until mounted: the URL decides, and rendering a tab first would
  // start that tab's fetch for nothing.
  const [tab, setTab] = useState<Tab | null>(null)

  useEffect(() => {
    setTab(tabFromUrl())
  }, [])

  function choose(next: Tab) {
    setTab(next)
    try {
      const url = new URL(window.location.href)
      if (next === 'lista') url.searchParams.set('tab', 'lista')
      else url.searchParams.delete('tab')
      window.history.replaceState(window.history.state, '', url)
    } catch {
      // URL only remembers the tab; nothing breaks without it.
    }
  }

  if (!role || !['admin', 'staff'].includes(role)) return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader title="Porositje të Sugjeruara" />

      <div role="tablist" className="flex gap-1 border-b border-slate-200 mb-5 -mt-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => choose(t.key)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stok' && <LowStockTab />}
      {tab === 'lista' && <ShoppingListTab />}
    </div>
  )
}
