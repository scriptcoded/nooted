import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
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
import { StatusChip } from '../../../../components/StatusChip.tsx'
import { isHttpUrl, pageLabel, relativeTime } from '../../../../format.ts'
import { NoteRouterLink, NoteText } from '../../../../components/NoteText.tsx'

export const Route = createFileRoute('/_authed/projects/$projectId/')({
  component: FeedbackPage,
})

function FeedbackPage() {
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
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
            <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Page</TableCell>
            <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Reporter</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Captures</TableCell>
            <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Created</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              hover
              data-testid="feedback-row"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a')) return
                void navigate({ to: '/projects/$projectId/feedback/$itemId', params: { projectId, itemId: item.id } })
              }}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ minWidth: { xs: 0, sm: 240 }, maxWidth: 480 }}>
                <Tooltip title={item.note} placement="bottom-start" enterDelay={600}>
                  <NoteRouterLink to="/projects/$projectId/feedback/$itemId" params={{ projectId, itemId: item.id }}>
                    <NoteText note={item.note} />
                  </NoteRouterLink>
                </Tooltip>
              </TableCell>
              <TableCell sx={{ minWidth: 150, maxWidth: 240, wordBreak: 'break-word', display: { xs: 'none', sm: 'table-cell' } }}>
                {isHttpUrl(item.url) ? (
                  <Link href={item.url} target="_blank" rel="noopener noreferrer">
                    {pageLabel(item.url)}
                  </Link>
                ) : (
                  pageLabel(item.url)
                )}
              </TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{item.reporter.name || item.reporter.email}</TableCell>
              <TableCell>
                <StatusChip status={item.status} />
              </TableCell>
              <TableCell align="right" data-testid="capture-count" sx={{ color: item.captureCount > 0 ? 'text.primary' : 'text.disabled' }}>
                {item.captureCount > 0 ? item.captureCount : '\u2014'}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap', display: { xs: 'none', sm: 'table-cell' } }}>
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
