import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api'

export async function GET() {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const users = await prisma.userRole.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(users)
  } catch (error) {
    return handleApiError(error, 'Users GET')
  }
}
