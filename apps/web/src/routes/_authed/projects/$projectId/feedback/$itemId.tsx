import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Link, Paper, Skeleton, Snackbar, Stack, Tooltip, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { ApiError, feedbackItemQuery } from '../../../../../queries.ts'
import { absoluteTime, isHttpUrl, pageLabel, relativeTime } from '../../../../../format.ts'
import { summarizeUserAgent } from '@nooted/shared/ua'
import { StatusSelect } from '../../../../../components/StatusSelect.tsx'
import { MuiRouterLink, NoteText } from '../../../../../components/NoteText.tsx'
import { CaptureCard } from '../../../../../components/CaptureCard.tsx'

export const Route = createFileRoute('/_authed/projects/$projectId/feedback/$itemId')({
  component: FeedbackItemPage,
})

function FeedbackItemPage() {
  const { projectId, itemId } = Route.useParams()
  const item = useQuery(feedbackItemQuery(projectId, itemId))
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const jumpTo = useCallback((n: number) => {
    document.getElementById(`capture-${n}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlighted(n)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHighlighted(null), 1200)
  }, [])

  const copy = useCallback((selector: string) => {
    void navigator.clipboard?.writeText(selector).then(() => setCopied(true), () => undefined)
  }, [])

  const back = (
    <MuiRouterLink
      to="/projects/$projectId"
      params={{ projectId }}
      underline="hover"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2, fontSize: '0.875rem' }}
    >
      <ArrowBackIcon sx={{ fontSize: 18 }} /> All feedback
    </MuiRouterLink>
  )

  let body: ReactNode
  if (item.isPending) {
    body = <DetailSkeleton />
  } else if (item.isError) {
    body =
      item.error instanceof ApiError && item.error.status === 404 ? (
        <Alert severity="warning">Feedback not found</Alert>
      ) : (
        <Alert severity="error">{item.error.message}</Alert>
      )
  } else {
    const data = item.data
    const numbers = data.captures.map((c) => c.n)
    body = (
      <Box
        sx={{
          display: 'grid',
          gap: 3,
          alignItems: 'start',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 2fr) minmax(0, 1fr)' },
          // The two columns start at 900 px, as in the design.
          '@media (min-width:900px)': { gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' },
          '@media (max-width:899.95px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography
              data-testid="feedback-note"
              sx={{ fontSize: '1.125rem', lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              <NoteText note={data.note} onRef={jumpTo} available={numbers} />
            </Typography>
          </Paper>
          {data.legacy && (
            <Alert severity="info">This report was sent by an older SDK and has no viewable captures.</Alert>
          )}
          {data.captures.length > 0 && (
            <Stack spacing={2} component="section" aria-label="Captures">
              <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                {data.captures.length === 1 ? '1 capture' : `${data.captures.length} captures`}
              </Typography>
              {data.captures.map((c) => (
                <CaptureCard
                  key={c.n}
                  projectId={projectId}
                  itemId={itemId}
                  capture={c}
                  highlighted={highlighted === c.n}
                  onCopy={copy}
                />
              ))}
            </Stack>
          )}
        </Stack>
        <Paper variant="outlined" component="aside" data-testid="feedback-meta" sx={{ p: 2.5, position: { md: 'sticky' }, top: { md: 16 }, order: { xs: -1, md: 0 } }}>
          <Stack spacing={2}>
            <Field label="Status">
              <StatusSelect projectId={projectId} itemId={itemId} status={data.status} />
            </Field>
            <Field label="Reporter">
              <Typography variant="body2">{data.reporter.name || data.reporter.email}</Typography>
              {data.reporter.name && (
                <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                  {data.reporter.email}
                </Typography>
              )}
            </Field>
            <Field label="Page">
              {isHttpUrl(data.url) ? (
                <Link
                  href={data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                  sx={{ overflowWrap: 'anywhere', display: 'inline-flex', alignItems: 'baseline', gap: 0.5 }}
                >
                  {pageLabel(data.url)}
                  <OpenInNewIcon sx={{ fontSize: 14, alignSelf: 'center' }} />
                </Link>
              ) : (
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {pageLabel(data.url)}
                </Typography>
              )}
            </Field>
            <Field label="Reported">
              <Tooltip title={relativeTime(data.createdAt)} placement="bottom-start">
                <Typography variant="body2" component="span" sx={{ width: 'fit-content' }}>
                  {absoluteTime(data.createdAt)}
                </Typography>
              </Tooltip>
            </Field>
            {data.capturedAt != null && (
              <Field label="Captured">
                <Tooltip title={relativeTime(data.capturedAt)} placement="bottom-start">
                  <Typography variant="body2" component="span" sx={{ width: 'fit-content' }}>
                    {absoluteTime(data.capturedAt)}
                  </Typography>
                </Tooltip>
              </Field>
            )}
            {data.device && (
              <Field label="Device">
                <Tooltip title={data.device.userAgent} placement="bottom-start">
                  <Typography variant="body2" component="span" sx={{ width: 'fit-content' }}>
                    {summarizeUserAgent(data.device.userAgent)}
                  </Typography>
                </Tooltip>
                <Typography variant="caption" color="text.secondary">
                  {data.device.viewport.width}×{data.device.viewport.height} @{data.device.viewport.devicePixelRatio}x
                </Typography>
              </Field>
            )}
            {data.release && (
              <Field label="Release">
                <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' }}>
                  {data.release}
                </Typography>
              </Field>
            )}
          </Stack>
        </Paper>
      </Box>
    )
  }

  return (
    <>
      {back}
      {body}
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Selector copied"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6, letterSpacing: '0.06em' }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

function DetailSkeleton() {
  return (
    <Box
      data-testid="detail-skeleton"
      sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, '@media (max-width:899.95px)': { gridTemplateColumns: '1fr' } }}
    >
      <Stack spacing={3}>
        <Skeleton variant="rounded" height={96} />
        <Skeleton variant="rounded" height={192} />
      </Stack>
      <Skeleton variant="rounded" height={320} />
    </Box>
  )
}
