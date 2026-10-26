import { createFileRoute, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Alert, CircularProgress, Tab, Tabs, Typography } from '@mui/material'
import { ApiError, projectQuery } from '../../../queries.ts'

export const Route = createFileRoute('/_authed/projects/$projectId')({
  component: ProjectLayout,
})

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const project = useQuery(projectQuery(projectId))
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const onSettings = Boolean(matchRoute({ to: '/projects/$projectId/settings', params: { projectId } }))

  if (project.isPending) return <CircularProgress />
  if (project.isError) {
    if (project.error instanceof ApiError && project.error.status === 404) {
      return <Alert severity="warning">Project not found</Alert>
    }
    return <Alert severity="error">{project.error.message}</Alert>
  }

  return (
    <>
      <Typography variant="h5" sx={{ mb: 1 }}>
        {project.data.name}
      </Typography>
      <Tabs
        value={onSettings ? 'settings' : 'feedback'}
        onChange={(_, value: string) =>
          void navigate(
            value === 'settings'
              ? { to: '/projects/$projectId/settings', params: { projectId } }
              : { to: '/projects/$projectId', params: { projectId } },
          )
        }
        sx={{ mb: 3 }}
      >
        <Tab label="Feedback" value="feedback" />
        <Tab label="Settings" value="settings" />
      </Tabs>
      <Outlet />
    </>
  )
}
