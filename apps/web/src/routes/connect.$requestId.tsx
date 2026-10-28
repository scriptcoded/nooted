import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, Divider, Paper, Skeleton, Stack, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { api } from '../api.ts'
import { requireSession } from '../auth-guard.ts'
import { ApiError, oauthRequestQuery, toApiError } from '../queries.ts'

export const Route = createFileRoute('/connect/$requestId')({
  beforeLoad: ({ context, location }) => requireSession(context.queryClient, location),
  component: ConnectPage,
})

function ConnectPage() {
  const { requestId } = Route.useParams()
  const request = useQuery(oauthRequestQuery(requestId))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const ready = request.isSuccess

  // Focus the heading rather than a button, so a stray Enter never approves anything.
  useEffect(() => {
    if (ready) headingRef.current?.focus()
  }, [ready])

  const expired = request.error instanceof ApiError && request.error.status === 404

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: { xs: 'flex-start', sm: 'center' },
        px: 2,
        py: { xs: 4, sm: 6 },
        bgcolor: 'background.default',
      }}
    >
      <Typography variant="h5" component="div" sx={{ fontWeight: 700, letterSpacing: '-0.02em', mb: 3 }}>
        nooted
      </Typography>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 440, p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
        {request.isPending && <ConsentSkeleton />}
        {expired && <Expired />}
        {request.isError && !expired && (
          <Stack spacing={2}>
            <Alert severity="error">Couldn't load this request. {request.error.message}</Alert>
            <Button variant="outlined" onClick={() => void request.refetch()}>
              Try again
            </Button>
          </Stack>
        )}
        {request.data && <Consent requestId={requestId} data={request.data} headingRef={headingRef} />}
      </Paper>
    </Box>
  )
}

function Expired() {
  return (
    <Stack spacing={1} data-testid="consent-expired" role="alert">
      <Typography variant="h6" component="h1">
        Request expired
      </Typography>
      <Typography color="text.secondary">This request has expired. Start again from your agent.</Typography>
    </Stack>
  )
}

function ConsentSkeleton() {
  return (
    <Stack spacing={2} aria-busy="true" aria-label="Loading request" data-testid="consent-loading">
      <Skeleton variant="text" sx={{ fontSize: '1.5rem' }} width="85%" />
      <Skeleton variant="text" width="50%" />
      <Skeleton variant="rounded" height={72} />
      <Skeleton variant="text" width="90%" />
      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
        <Skeleton variant="rounded" width={80} height={36} />
        <Skeleton variant="rounded" width={80} height={36} />
      </Stack>
    </Stack>
  )
}

type RequestData = { clientName: string; redirectHost: string; scopes: string[]; email: string }

function Consent({
  requestId,
  data,
  headingRef,
}: {
  requestId: string
  data: RequestData
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const [choice, setChoice] = useState<'allow' | 'deny' | null>(null)
  const canWrite = data.scopes.includes('feedback.write')

  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      const res = await api.oauth.requests[':id'].decision.$post({ param: { id: requestId }, json: { approve } })
      if (!res.ok) throw await toApiError(res)
      return res.json()
    },
    onSuccess: ({ redirectTo }) => {
      // Leaves the console, so keep the buttons disabled until the browser navigates.
      window.location.href = redirectTo
    },
  })

  const submit = (approve: boolean) => {
    setChoice(approve ? 'allow' : 'deny')
    decide.mutate(approve)
  }

  if (decide.error instanceof ApiError && decide.error.status === 404) return <Expired />

  // Stays true after success, since the page is navigating away.
  const busy = decide.isPending || decide.isSuccess

  return (
    <Box data-testid="consent-card">
      <Typography
        variant="h5"
        component="h1"
        tabIndex={-1}
        ref={headingRef}
        sx={{ fontWeight: 600, outline: 'none', overflowWrap: 'anywhere' }}
      >
        Connect{' '}
        <Box component="span" data-testid="consent-client-name">
          “{data.clientName}”
        </Box>{' '}
        to Nooted?
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        This name was provided by the app itself.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Signed in as <strong>{data.email}</strong>
      </Typography>

      <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
        This will let it:
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="consent-permissions">
        <Permission>Read change requests in your projects</Permission>
        {canWrite && <Permission>Update their status</Permission>}
      </Box>

      <Typography variant="body2" sx={{ mt: 2 }}>
        It will be able to see every project you can see.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        You can disconnect it at any time under Connected agents.
      </Typography>

      {decide.isError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          Something went wrong. Please try again.
        </Alert>
      )}

      <Divider sx={{ my: 3 }} />

      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          color="inherit"
          disabled={busy}
          onClick={() => submit(false)}
          data-testid="consent-deny"
          startIcon={busy && choice === 'deny' ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Deny
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => submit(true)}
          data-testid="consent-allow"
          startIcon={busy && choice === 'allow' ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Allow
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'right' }}>
        After you choose, you'll return to <strong>{data.redirectHost}</strong>.
      </Typography>
    </Box>
  )
}

function Permission({ children }: { children: React.ReactNode }) {
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <CheckIcon fontSize="small" color="success" />
      <Typography variant="body2">{children}</Typography>
    </Box>
  )
}
