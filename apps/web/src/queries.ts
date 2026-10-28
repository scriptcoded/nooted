import { queryOptions } from '@tanstack/react-query'
import { api } from './api.ts'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Turns a failed response into an ApiError, using the server's validation message when present.
export async function toApiError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`
  try {
    const body: unknown = await res.json()
    if (typeof body === 'object' && body !== null && 'issues' in body && Array.isArray(body.issues)) {
      const messages = body.issues.flatMap((i: unknown) =>
        typeof i === 'object' && i !== null && 'message' in i && typeof i.message === 'string' ? [i.message] : [],
      )
      if (messages.length > 0) message = messages.join(', ')
    } else if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      message = body.error
    }
  } catch {
    // Not JSON; keep the generic message.
  }
  return new ApiError(res.status, message)
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => {
    const res = await api.me.$get()
    if (!res.ok) throw await toApiError(res)
    return res.json()
  },
  retry: false,
  staleTime: 60_000,
})

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: async () => {
    const res = await api.projects.$get()
    if (!res.ok) throw await toApiError(res)
    return res.json()
  },
})

export const projectQuery = (id: string) =>
  queryOptions({
    queryKey: ['project', id],
    queryFn: async () => {
      const res = await api.projects[':id'].$get({ param: { id } })
      if (!res.ok) throw await toApiError(res)
      return res.json()
    },
    retry: false,
  })

export const feedbackQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['feedback', projectId],
    queryFn: async () => {
      const res = await api.projects[':id'].feedback.$get({ param: { id: projectId } })
      if (!res.ok) throw await toApiError(res)
      return res.json()
    },
  })

export const feedbackItemQuery = (projectId: string, itemId: string) =>
  queryOptions({
    queryKey: ['feedback', projectId, itemId],
    queryFn: async () => {
      const res = await api.projects[':id'].feedback[':itemId'].$get({ param: { id: projectId, itemId } })
      if (!res.ok) throw await toApiError(res)
      return res.json()
    },
    retry: false,
  })

export const oauthRequestQuery = (id: string) =>
  queryOptions({
    queryKey: ['oauth-request', id],
    queryFn: async () => {
      const res = await api.oauth.requests[':id'].$get({ param: { id } })
      if (!res.ok) throw await toApiError(res)
      return res.json()
    },
    retry: false,
    staleTime: Infinity,
  })

export const grantsQuery = queryOptions({
  queryKey: ['oauth-grants'],
  queryFn: async () => {
    const res = await api.oauth.grants.$get()
    if (!res.ok) throw await toApiError(res)
    return res.json()
  },
})
