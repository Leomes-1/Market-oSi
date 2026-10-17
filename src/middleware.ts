import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Faqe që duhet të hapen edhe pa qenë i loguar.
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password']

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )

          supabaseResponse = NextResponse.next({ request })

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  // API routes are now covered too. They answer with JSON 401 rather than a
  // redirect, so fetch() callers get a status they can act on. Individual
  // handlers still run their own requireRole check — this is the outer gate,
  // not the only one.
  if (!user && isApi) {
    return NextResponse.json(
      { error: 'Jo i autentikuar', code: 'UNAUTHENTICATED' },
      { status: 401 }
    )
  }

  // Nëse nuk je i loguar dhe kërkon faqe private -> login
  if (!user && !PUBLIC_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Nëse je i loguar dhe hap login/forgot-password -> dashboard
  // MOS ridrejto /reset-password sepse recovery krijon session të përkohshëm
  if (
    user &&
    (pathname === '/login' || pathname === '/forgot-password')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  // `api/` is deliberately NOT excluded any more — every API route is
  // authenticated. Only Next's own static assets bypass the middleware.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
