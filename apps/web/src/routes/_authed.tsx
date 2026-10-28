import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AppBar, Box, Button, Chip, Container, Divider, ListItemIcon, Menu, MenuItem, Toolbar, Typography } from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import { meQuery } from '../queries.ts'
import { requireSession } from '../auth-guard.ts'

export const Route = createFileRoute('/_authed')({
  beforeLoad: ({ context, location }) => requireSession(context.queryClient, location),
  component: AuthedLayout,
})

function AuthedLayout() {
  const me = useQuery(meQuery)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

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
              {me.data.isAdmin && <Chip label="Admin" size="small" color="secondary" sx={{ mr: 1 }} />}
              <Button
                color="inherit"
                data-testid="user-menu-button"
                aria-haspopup="menu"
                aria-expanded={anchor ? 'true' : undefined}
                endIcon={<KeyboardArrowDownIcon />}
                onClick={(e) => setAnchor(e.currentTarget)}
                sx={{ textTransform: 'none', maxWidth: { xs: 160, sm: 'none' } }}
              >
                <Typography noWrap>{me.data.name || me.data.email}</Typography>
              </Button>
              <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)} slotProps={{ list: { 'aria-label': 'Account' } }}>
                <MenuItem
                  data-testid="menu-connected-agents"
                  onClick={() => {
                    setAnchor(null)
                    void navigate({ to: '/settings/agents' })
                  }}
                >
                  <ListItemIcon>
                    <SmartToyOutlinedIcon fontSize="small" />
                  </ListItemIcon>
                  Connected agents
                </MenuItem>
                <Divider />
                <MenuItem data-testid="menu-sign-out" onClick={signOut}>
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" />
                  </ListItemIcon>
                  Sign out
                </MenuItem>
              </Menu>
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
