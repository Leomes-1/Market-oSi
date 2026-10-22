import { cache } from 'react'
import { headers } from 'next/headers'
import { USER_EMAIL_HEADER, USER_ID_HEADER } from './auth-header'
import { prisma } from './prisma'
import { Role } from './roles'
import { scheduleSnapshot } from './backups/snapshot'

/**
 * Per-request session resolution, deduplicated with React's `cache()`.
 *
 * The session is verified once per request, by `supabase.auth.getUser()` in
 * middleware, which forwards the user in headers only it can set (any copy
 * the browser sent is deleted first — see lib/auth-header). This reads those
 * instead of asking Supabase a second time.
 *
 * `cache()` memoises per React request, so every server component in one render
 * shares one result. It deliberately does NOT span the layout render and a
 * later API call — those are separate requests, and each one is verified by
 * its own pass through the middleware.
 */

/** Next's "this route is dynamic" signal, thrown during static analysis. */
function isDynamicServerError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { digest?: unknown }).digest === 'DYNAMIC_SERVER_USAGE'
  )
}

export interface SessionUser {
  userId: string
  email: string
  role: Role
}

/** The authenticated user for this request, or null. Memoised per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const h = headers()
    const id = h.get(USER_ID_HEADER)
    if (!id) return null
    const user = { id, email: decodeURIComponent(h.get(USER_EMAIL_HEADER) ?? '') }

    const userRole = await prisma.userRole.findUnique({ where: { userId: user.id } })
    if (userRole) {
      return { userId: user.id, email: user.email || '', role: userRole.roli as Role }
    }

    // First sign-in: provision the row. The very first user to reach the app
    // becomes admin; everyone after that starts as staff.
    const count = await prisma.userRole.count()
    const created = await prisma.userRole.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        email: user.email || '',
        roli: count === 0 ? 'admin' : 'staff',
      },
    })
    scheduleSnapshot()
    return { userId: user.id, email: created.email, role: created.roli as Role }
  } catch (error) {
    // Next throws a DynamicServerError while probing whether a route can be
    // rendered statically. It must propagate — swallowing it would stop Next
    // marking the route dynamic — and it is not a real failure, so it must not
    // be logged either.
    if (isDynamicServerError(error)) throw error
    console.error('getSessionUser:', error)
    return null
  }
})

/** Just the role, for callers that need nothing else. Shares the same cache. */
export async function getSessionRole(): Promise<Role | null> {
  const user = await getSessionUser()
  return user?.role ?? null
}
