import { cache } from 'react'
import { createClient } from './supabase/server'
import { prisma } from './prisma'
import { Role } from './roles'
import { scheduleSnapshot } from './backups/snapshot'

/**
 * Per-request session resolution, deduplicated with React's `cache()`.
 *
 * A single page navigation used to resolve the same user three times: once in
 * middleware, once in the root layout, and once more in whichever API route the
 * page called. Each resolution costs a Supabase `getUser()` round-trip (~75 ms)
 * plus a `UserRole` lookup (~170 ms).
 *
 * `cache()` memoises per React request, so every server component in one render
 * shares one result. It deliberately does NOT span the layout render and a
 * later API call — those are separate requests, and the route handler must keep
 * verifying the session itself. That duplication is the security boundary, not
 * waste.
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
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return null

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
