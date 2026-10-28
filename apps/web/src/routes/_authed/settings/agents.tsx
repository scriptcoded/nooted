import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Skeleton,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import { api } from '../../../api.ts'
import { grantsQuery, toApiError } from '../../../queries.ts'
import { absoluteTime, relativeTime } from '../../../format.ts'

export const Route = createFileRoute('/_authed/settings/agents')({
  component: AgentsPage,
})

type Grant = { id: string; clientName: string; scopes: string[]; createdAt: number; lastUsedAt: number | null }

const wide = { xs: 'none', md: 'table-cell' }

function accessLabel(scopes: string[]) {
  return scopes.includes('feedback.write') ? 'Read and update status' : 'Read'
}

function AgentsPage() {
  const grants = useQuery(grantsQuery)
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState<Grant | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const revoke = useMutation({
    mutationFn: async (grant: Grant) => {
      const res = await api.oauth.grants[':id'].$delete({ param: { id: grant.id } })
      // Already gone counts as revoked.
      if (!res.ok && res.status !== 404) throw await toApiError(res)
      return grant
    },
    onSuccess: async (grant) => {
      setRevoking(null)
      setNotice(`Revoked ${grant.clientName}`)
      await queryClient.invalidateQueries({ queryKey: grantsQuery.queryKey })
    },
  })

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Typography variant="h5" component="h1">
        Connected agents
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        Agents you've allowed to read change requests through MCP.
      </Typography>

      {grants.isPending && <Skeleton variant="rounded" height={120} />}
      {grants.isError && <Alert severity="error">{grants.error.message}</Alert>}
      {grants.data && grants.data.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-testid="agents-empty">
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            No agents connected yet
          </Typography>
          <ConnectInstructions />
        </Paper>
      )}
      {grants.data && grants.data.length > 0 && (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table data-testid="agents-table">
              <TableHead>
                <TableRow>
                  <TableCell>Agent</TableCell>
                  <TableCell sx={{ display: wide }}>Access</TableCell>
                  <TableCell sx={{ display: wide }}>Connected</TableCell>
                  <TableCell sx={{ display: wide }}>Last used</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {grants.data.map((g) => (
                  <TableRow key={g.id} data-testid="agent-row">
                    <TableCell sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                      {g.clientName}
                      {/* Narrow screens fold the other columns under the name. */}
                      <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 0.5, fontWeight: 400 }}>
                        <Typography variant="body2" color="text.secondary">
                          {accessLabel(g.scopes)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Connected {relativeTime(g.createdAt)} · Last used{' '}
                          {g.lastUsedAt === null ? 'never' : relativeTime(g.lastUsedAt)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', display: wide }}>{accessLabel(g.scopes)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', display: wide }}>
                      <Tooltip title={absoluteTime(g.createdAt)}>
                        <span>{relativeTime(g.createdAt)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', display: wide }}>
                      {g.lastUsedAt === null ? (
                        <Typography variant="body2" color="text.secondary">
                          Never
                        </Typography>
                      ) : (
                        <Tooltip title={absoluteTime(g.lastUsedAt)}>
                          <span>{relativeTime(g.lastUsedAt)}</span>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ verticalAlign: 'top' }}>
                      <Button size="small" color="error" data-testid="agent-revoke" onClick={() => setRevoking(g)}>
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ mt: 4 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              How to connect another agent
            </Typography>
            <ConnectInstructions />
          </Box>
        </>
      )}

      <Dialog
        open={revoking !== null}
        onClose={() => {
          if (!revoke.isPending) setRevoking(null)
        }}
        maxWidth="xs"
        fullWidth
        slotProps={{ transition: { onExited: () => revoke.reset() } }}
      >
        <DialogTitle sx={{ overflowWrap: 'anywhere' }}>Revoke {revoking?.clientName}?</DialogTitle>
        <DialogContent>
          <DialogContentText>It will lose access immediately.</DialogContentText>
          {revoke.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {revoke.error.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={revoke.isPending} onClick={() => setRevoking(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            data-testid="agent-revoke-confirm"
            disabled={revoke.isPending}
            startIcon={revoke.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
            onClick={() => revoking && revoke.mutate(revoking)}
          >
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={notice !== null} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice} />
    </Box>
  )
}

function ConnectInstructions() {
  const origin = window.location.origin
  const command = `claude mcp add --transport http nooted ${origin}/mcp`
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; the command is selectable text.
    }
  }

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        To connect Claude Code, run:
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          p: 1.5,
          borderRadius: 1,
          bgcolor: 'action.hover',
          border: 1,
          borderColor: 'divider',
        }}
      >
        <Box
          component="code"
          data-testid="mcp-command"
          sx={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, overflowWrap: 'anywhere' }}
        >
          {command}
        </Box>
        <Tooltip title={copied ? 'Copied' : 'Copy'}>
          <IconButton size="small" aria-label="Copy command" data-testid="mcp-copy" onClick={() => void copy()} sx={{ mt: -0.25 }}>
            {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" sx={{ mt: 1.5 }}>
        Then run <code>/mcp</code> in Claude Code and choose Authenticate.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Any MCP client that supports OAuth works with the URL <code>{origin}/mcp</code>.
      </Typography>
    </Box>
  )
}
