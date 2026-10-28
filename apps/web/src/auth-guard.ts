import type { QueryClient } from '@tanstack/react-query'
import { ApiError, meQuery } from './queries.ts'

// Ensures a session exists; otherwise sends the browser to login and returns here afterwards.
export async function requireSession(queryClient: QueryClient, location: { pathname: string; searchStr: string }) {
  try {
    await queryClient.ensureQueryData(meQuery)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // /auth/login is a server route, so this must be a full page navigation.
      window.location.href = '/auth/login?returnTo=' + encodeURIComponent(location.pathname + location.searchStr)
      // Never resolves, so nothing renders while the browser navigates away.
      return new Promise<never>(() => {})
    }
    throw error
  }
}
