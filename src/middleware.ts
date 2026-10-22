import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_HEADERS, USER_EMAIL_HEADER, USER_ID_HEADER } from '@/lib/auth-header'

// Faqe që duhet të hapen edhe pa qenë i loguar.
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password']

export async function middleware(request: NextRequest) {
  // Cookies and headers Supabase wants on the response (a refreshed session).
  let cookiesToSet: { name: string; value: string; options?: Parameters<NextResponse['cookies']['set']>[2] }[] = []
  let headersToSet: Record<string, string> = {}

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookies, headers) {
          // Also onto the request, so the handler downstream reads the
          // refreshed session rather than the expired one.
          cookies.forEach(({ name, value }) => request.cookies.set(name, value))
          cookiesToSet = cookies
          headersToSet = headers ?? {}
        },
      },
    }
  )

  // The one authoritative session check for this request. Route handlers and
  // the root layout read its result from the headers set below instead of
  // asking Supabase again.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  // API routes are now covered too. They answer with JSON 401 rather than a
  // redirect, so fetch() callers get a status they can act on. Individual
  // handlers still run their own requireRole check — this is the outer gate,
  // not the only one.
  // The one exception: Vercel Cron has no session. That route refuses any
  // request without the CRON_SECRET bearer token, and its POST (the admin
  // button) still checks the session role itself.
  const isCronRoute = pathname === '/api/backups/email'

  if (!user && isApi && !isCronRoute) {
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

  // Forward the verified identity. Any copy of these headers the browser sent
  // is deleted first, unconditionally — otherwise a request with no session
  // (the cron path above) could arrive carrying a forged user id.
  const forwarded = new Headers(request.headers)
  for (const name of AUTH_HEADERS) forwarded.delete(name)
  if (user) {
    forwarded.set(USER_ID_HEADER, user.id)
    forwarded.set(USER_EMAIL_HEADER, encodeURIComponent(user.email ?? ''))
  }

  const response = NextResponse.next({ request: { headers: forwarded } })
  cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
  Object.entries(headersToSet).forEach(([key, value]) => response.headers.set(key, value))
  return response
}

export const config = {
  // `api/` is deliberately NOT excluded any more — every API route is
  // authenticated. Only Next's own static assets bypass the middleware.
  // Every path that runs a route handler or server component MUST stay
  // matched: they trust the user headers this middleware sets (lib/auth-header).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
