import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from '@mui/material'
import LogoutIcon from '@mui/icons-material/Logout'
import { ApiError, meQuery } from '../queries.ts'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // /auth/login is a server route, so this must be a full page navigation.
        window.location.href = '/auth/login?returnTo=' + encodeURIComponent(location.pathname + location.searchStr)
        // Never resolves, so nothing renders while the browser navigates away.
        return new Promise<never>(() => {})
      }
      throw error
    }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const me = useQuery(meQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const signOut = async () => {
    await fetch('/auth/logout', { method: 'POST' })
    queryClient.clear()
    window.location.href = '/auth/login'
  }

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="a" href="/" onClick={(e) => { e.preventDefault(); void navigate({ to: '/' }) }} sx={{ color: 'inherit', textDecoration: 'none' }}>
            nooted
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {me.data && (
            <>
              <Typography sx={{ mr: 1 }}>{me.data.name || me.data.email}</Typography>
              {me.data.isAdmin && <Chip label="Admin" size="small" color="secondary" sx={{ mr: 2 }} />}
              <Button color="inherit" startIcon={<LogoutIcon />} onClick={signOut}>
                Sign out
              </Button>
            </>
          )}
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 3 }}>
        <Outlet />
      </Container>
    </>
  )
}
