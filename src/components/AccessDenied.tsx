'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RiLockLine } from 'react-icons/ri'
import { useRole } from '@/contexts/RoleContext'

/** Where a role lands instead of seeing "Akses i Mohuar". */
const HOME_FOR_ROLE: Partial<Record<string, string>> = {
  // Cashiers only work the till: login lands on "/" (the admin dashboard), so
  // this is also what sends them to the POS after signing in.
  cashier: '/shitjet',
}

export default function AccessDenied() {
  const { role } = useRole()
  const router = useRouter()
  const home = role ? HOME_FOR_ROLE[role] : undefined

  useEffect(() => {
    if (home) router.replace(home)
  }, [home, router])

  // Redirecting — show nothing rather than flash the denial.
  if (home) return null

  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <RiLockLine className="text-red-500 text-2xl" />
        </div>
        <h2 className="text-xl font-semibold text-slate-800 mb-2">Akses i Mohuar</h2>
        <p className="text-slate-500">Nuk ke akses në këtë faqe</p>
      </div>
    </div>
  )
}
