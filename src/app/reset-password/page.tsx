'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  RiStore2Line,
  RiEyeLine,
  RiEyeOffLine,
  RiLoader4Line,
} from 'react-icons/ri'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const router = useRouter()

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (password.length < 6) {
      setError('Fjalëkalimi duhet të ketë të paktën 6 karaktere')
      return
    }

    if (password !== confirmPassword) {
      setError('Fjalëkalimet nuk përputhen')
      return
    }

    setLoading(true)

    const supabase = createClient()

    const { error } = await supabase.auth.updateUser({
      password,
    })

    if (error) {
      setError(
        'Linku mund të ketë skaduar ose sesioni nuk është i vlefshëm. Provo përsëri.'
      )
      setLoading(false)
      return
    }

    setSuccess('Fjalëkalimi u ndryshua me sukses.')

    await supabase.auth.signOut()

    setTimeout(() => {
      router.push('/login')
      router.refresh()
    }, 1500)
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
            Ndrysho fjalëkalimin
          </h1>

          <p className="text-sm text-slate-500 mb-6">
            Vendos fjalëkalimin tënd të ri.
          </p>

          <form onSubmit={handleResetPassword} className="space-y-4">

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Fjalëkalimi i ri
              </label>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition pr-10"
                  placeholder="••••••••"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <RiEyeOffLine className="text-base" />
                  ) : (
                    <RiEyeLine className="text-base" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Konfirmo fjalëkalimin
              </label>

              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                placeholder="••••••••"
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
                  Duke ruajtur...
                </>
              ) : (
                'Ndrysho fjalëkalimin'
              )}
            </button>

          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Market OS — Sistem i menaxhimit të marketit
        </p>

      </div>
    </div>
  )
}