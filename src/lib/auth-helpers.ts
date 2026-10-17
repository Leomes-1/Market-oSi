import { createClient } from './supabase/server'
import { prisma } from './prisma'
import { NextResponse } from 'next/server'
import { Role } from './roles'
import { apiError } from './api'

export interface AuthResult {
  userId: string | null
  role: Role | null
  error: NextResponse | null
}

/**
 * Resolves the caller from the Supabase session cookie and looks up their role.
 *
 * Unlike the root layout, this never creates a UserRole row — an API call is
 * not the place to provision an account. A signed-in user with no row is
 * treated as 'staff', the least-privileged default.
 */
export async function getAuthUserAndRole(): Promise<AuthResult> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return {
        userId: null,
        role: null,
        error: apiError('Jo i autentikuar', 401, 'UNAUTHENTICATED'),
      }
    }

    const userRole = await prisma.userRole.findUnique({ where: { userId: user.id } })
    const role = (userRole?.roli as Role) || 'staff'

    return { userId: user.id, role, error: null }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { digest?: unknown }).digest === 'DYNAMIC_SERVER_USAGE'
    ) {
      throw error
    }
    console.error('getAuthUserAndRole:', error)
    return {
      userId: null,
      role: null,
      error: apiError('Gabim në server', 500, 'SERVER_ERROR'),
    }
  }
}

/** Any signed-in user, whatever their role. 401 if not signed in. */
export async function requireAuth(): Promise<AuthResult> {
  return getAuthUserAndRole()
}

/**
 * Requires a signed-in user holding one of `allowedRoles`.
 * 401 when there is no session, 403 when the role doesn't match.
 */
export async function requireRole(allowedRoles: Role[]): Promise<AuthResult> {
  const result = await getAuthUserAndRole()
  if (result.error) return result

  if (!result.role || !allowedRoles.includes(result.role)) {
    return {
      userId: result.userId,
      role: result.role,
      error: apiError('Nuk ke akses', 403, 'FORBIDDEN'),
    }
  }

  return result
}
