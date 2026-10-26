import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { feedbackQuery } from '../../../../queries.ts'

export const Route = createFileRoute('/_authed/projects/$projectId/')({
  component: FeedbackPage,
})

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

function relativeTime(iso: string | number): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

function pageLabel(url: string): string {
  try {
    const u = new URL(url)
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function statusLabel(status: string): string {
  if (status === 'new') return 'New'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function FeedbackPage() {
  const { projectId } = Route.useParams()
  const feedback = useQuery(feedbackQuery(projectId))

  if (feedback.isPending) return <CircularProgress />
  if (feedback.isError) return <Alert severity="error">{feedback.error.message}</Alert>
  const items = feedback.data.items
  if (items.length === 0) {
    return (
      <Typography color="text.secondary">
        No feedback yet. Shake your phone on a site with Nooted enabled to send some.
      </Typography>
    )
  }

  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Note</TableCell>
            <TableCell>Page</TableCell>
            <TableCell>Reporter</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Created</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} hover>
              <TableCell sx={{ minWidth: 240, maxWidth: 480 }}>
                <Tooltip title={item.note} placement="bottom-start">
                  <Typography
                    variant="body2"
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {item.note}
                  </Typography>
                </Tooltip>
              </TableCell>
              <TableCell sx={{ maxWidth: 240, overflowWrap: 'anywhere' }}>
                {isHttpUrl(item.url) ? (
                  <Link href={item.url} target="_blank" rel="noopener noreferrer">
                    {pageLabel(item.url)}
                  </Link>
                ) : (
                  pageLabel(item.url)
                )}
              </TableCell>
              <TableCell>{item.reporter.name || item.reporter.email}</TableCell>
              <TableCell>
                <Chip label={statusLabel(item.status)} size="small" color={item.status === 'new' ? 'primary' : 'default'} />
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                <Tooltip title={new Date(item.createdAt).toLocaleString()}>
                  <span>{relativeTime(item.createdAt)}</span>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
