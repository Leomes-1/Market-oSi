'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { RiStore2Line, RiLoader4Line, RiArrowLeftLine } from 'react-icons/ri'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()

    setError('')
    setSuccess('')
    setLoading(true)

    try {
      const supabase = createClient()

      const redirectTo = `${window.location.origin}/reset-password`

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      })

      if (error) {
        setError('Nuk u dërgua dot email-i. Provo përsëri.')
        return
      }

      setSuccess(
        'Linku për ndryshimin e fjalëkalimit u dërgua. Kontrollo email-in tënd.'
      )
    } catch {
      setError('Ndodhi një gabim. Provo përsëri.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm">
            <RiStore2Line className="text-white text-xl" />
          </div>

          <div>
            <span className="text-slate-900 font-bold text-xl leading-none block">
              Market OS
            </span>
            <span className="text-slate-400 text-xs">
              Sistemi i Marketit
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h1 className="text-slate-900 font-semibold text-lg mb-2">
            Harrove fjalëkalimin?
          </h1>

          <p className="text-sm text-slate-500 mb-6">
            Shkruaj email-in e llogarisë dhe do të të dërgojmë një link për të
            vendosur një fjalëkalim të ri.
          </p>

          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                placeholder="email@shembull.com"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 px-3.5 py-2.5 rounded-lg">
                {error}
              </div>
            )}

            {success && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-100 px-3.5 py-2.5 rounded-lg">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RiLoader4Line className="animate-spin" />
                  Duke dërguar...
                </>
              ) : (
                'Dërgo linkun'
              )}
            </button>
          </form>

          <Link
            href="/login"
            className="mt-5 flex items-center justify-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
          >
            <RiArrowLeftLine />
            Kthehu te hyrja
          </Link>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Market OS — Sistem i menaxhimit të marketit
        </p>
      </div>
    </div>
  )
}