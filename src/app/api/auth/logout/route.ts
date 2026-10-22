import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Signs the caller out on the server, so the shared layout (the sidebar's
 * logout button) doesn't have to ship the Supabase browser library to every
 * page. Same call the browser used to make: it revokes the session with
 * Supabase Auth and clears the session cookies on this response.
 *
 * The middleware already turns a request with no session into a 401.
 */
export async function POST() {
  const supabase = createClient()
  const { error } = await supabase.auth.signOut()
  if (error) console.error('Logout:', error)
  return NextResponse.json({ success: true })
}
