import { useState } from 'react'
import { Alert, Menu, MenuItem, Snackbar } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FEEDBACK_STATUSES } from '@nooted/shared/status'
import type { FeedbackStatus } from '@nooted/shared/status'
import { api } from '../api.ts'
import { toApiError } from '../queries.ts'
import { StatusChip } from './StatusChip.tsx'

type Detail = { status: string }

// A status chip that opens a menu. Updates the cached item optimistically and rolls back on failure.
export function StatusSelect({ projectId, itemId, status }: { projectId: string; itemId: string; status: string }) {
  const queryClient = useQueryClient()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const itemKey = ['feedback', projectId, itemId]

  const mutation = useMutation({
    mutationFn: async (next: FeedbackStatus) => {
      const res = await api.projects[':id'].feedback[':itemId'].$patch({ param: { id: projectId, itemId }, json: { status: next } })
      if (!res.ok) throw await toApiError(res)
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: itemKey })
      const previous = queryClient.getQueryData<Detail>(itemKey)
      if (previous) queryClient.setQueryData<Detail>(itemKey, { ...previous, status: next })
      return { previous }
    },
    onError: (err, _next, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(itemKey, ctx.previous)
      setError(err.message)
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: itemKey }),
        queryClient.invalidateQueries({ queryKey: ['feedback', projectId], exact: true }),
      ])
    },
  })

  return (
    <>
      <StatusChip
        status={status}
        data-testid="status-select"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        sx={{ alignSelf: 'flex-start' }}
      />
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {FEEDBACK_STATUSES.map((s) => (
          <MenuItem
            key={s}
            selected={s === status}
            data-testid={`status-option-${s}`}
            onClick={() => {
              setAnchor(null)
              if (s !== status) mutation.mutate(s)
            }}
          >
            <StatusChip status={s} variant={s === status ? 'filled' : 'outlined'} sx={{ pointerEvents: 'none' }} />
          </MenuItem>
        ))}
      </Menu>
      <Snackbar open={error !== null} autoHideDuration={5000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </>
  )
}
