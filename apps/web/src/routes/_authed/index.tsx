import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { api } from '../../api.ts'
import { meQuery, projectsQuery, toApiError } from '../../queries.ts'

export const Route = createFileRoute('/_authed/')({
  component: ProjectsPage,
})

function ProjectsPage() {
  const me = useQuery(meQuery)
  const projects = useQuery(projectsQuery)
  const [creating, setCreating] = useState(false)
  const isAdmin = me.data?.isAdmin ?? false

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Projects
        </Typography>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </Box>
      {projects.isPending && <CircularProgress />}
      {projects.isError && <Alert severity="error">{projects.error.message}</Alert>}
      {projects.data && projects.data.length === 0 && (
        <Typography color="text.secondary">
          {isAdmin ? 'Create your first project' : "You're not a member of any project yet — ask an admin"}
        </Typography>
      )}
      {projects.data && projects.data.length > 0 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Public key</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.data.map((project) => (
                <TableRow key={project.id} hover>
                  <TableCell>
                    <Link to="/projects/$projectId" params={{ projectId: project.id }}>
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{project.publicKey}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <CreateProjectDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const create = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.projects.$post({ json: { name } })
      if (!res.ok) throw await toApiError(res)
      return res.json()
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setName('')
      onClose()
      await navigate({ to: '/projects/$projectId/settings', params: { projectId: project.id } })
    },
  })

  const close = () => {
    create.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate(name)
        }}
      >
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            required
            margin="dense"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {create.isError && <Alert severity="error" sx={{ mt: 1 }}>{create.error.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!name.trim() || create.isPending}>
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
