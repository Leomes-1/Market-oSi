/**
 * Headers the middleware uses to hand the verified user to route handlers and
 * server components, so the session is checked with Supabase once per request
 * instead of once in middleware and again in the handler.
 *
 * Trust rule: these are only ever set by middleware.ts, which first DELETES any
 * copy the browser sent and then sets its own, from `supabase.auth.getUser()`.
 * That only holds for paths the middleware runs on — every page and every
 * /api route today. A path excluded from the middleware matcher must never read
 * them.
 *
 * Kept free of imports so the Edge middleware bundle can use it.
 */
export const USER_ID_HEADER = 'x-market-user-id'
export const USER_EMAIL_HEADER = 'x-market-user-email'

export const AUTH_HEADERS = [USER_ID_HEADER, USER_EMAIL_HEADER] as const
