import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { toApiError } from '../queries.ts'

/** A capture's rrweb events. Immutable, so cached forever; nothing is fetched until `enabled`. */
export function useCaptureEvents(projectId: string, itemId: string, n: number, enabled: boolean) {
  return useQuery({
    queryKey: ['capture-events', projectId, itemId, n],
    enabled,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      const res = await api.projects[':id'].feedback[':itemId'].captures[':n'].events.$get({
        param: { id: projectId, itemId, n: String(n) },
      })
      if (!res.ok) throw await toApiError(res)
      return (await res.json()) as unknown[]
    },
  })
}
