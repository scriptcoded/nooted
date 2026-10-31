import { createFileRoute } from '@tanstack/react-router'
import { Box, Button, Paper, Typography } from '@mui/material'

// Where the IdP returns after sign-out. It must not start a login by itself, or a
// still-live IdP session would sign the user straight back in.
export const Route = createFileRoute('/signed-out')({
  component: SignedOutPage,
})

function SignedOutPage() {
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
        <Typography variant="h6" component="h1" gutterBottom>
          You're signed out
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          You can close this tab, or sign in again.
        </Typography>
        {/* /auth/login is a server route, so this must be a full page navigation. */}
        <Button variant="contained" href="/auth/login" data-testid="sign-in-again">
          Sign in again
        </Button>
      </Paper>
    </Box>
  )
}
