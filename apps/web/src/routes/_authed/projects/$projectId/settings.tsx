import { useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import { api } from '../../../../api.ts'
import { projectQuery, toApiError } from '../../../../queries.ts'

export const Route = createFileRoute('/_authed/projects/$projectId/settings')({
  component: SettingsPage,
})

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  )
}

// Runs a project mutation, then refreshes the project and the list (name/retention show there too).
function useProjectMutation<V>(projectId: string, run: (variables: V) => Promise<Response>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: V) => {
      const res = await run(variables)
      if (!res.ok) throw await toApiError(res)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ])
    },
  })
}

function SettingsPage() {
  const { projectId } = Route.useParams()
  const { data: project } = useQuery(projectQuery(projectId))
  const [copied, setCopied] = useState(false)
  const param = { id: projectId }

  const rename = useProjectMutation(projectId, (name: string) => api.projects[':id'].$patch({ param, json: { name } }))
  const setRetention = useProjectMutation(projectId, (retentionDays: number | null) =>
    api.projects[':id'].$patch({ param, json: { retentionDays } }),
  )
  const addOrigin = useProjectMutation(projectId, (origin: string) =>
    api.projects[':id'].origins.$post({ param, json: { origin } }),
  )
  const removeOrigin = useProjectMutation(projectId, (origin: string) =>
    api.projects[':id'].origins.$delete({ param, json: { origin } }),
  )
  const addMember = useProjectMutation(projectId, (email: string) =>
    api.projects[':id'].members.$post({ param, json: { email } }),
  )
  const removeMember = useProjectMutation(projectId, (email: string) =>
    api.projects[':id'].members.$delete({ param, json: { email } }),
  )

  if (!project) return null
  const canManage = project.canManage

  return (
    <>
      <Section title="Project">
        <Stack spacing={2}>
          <NameField key={project.name} value={project.name} canManage={canManage} mutation={rename} />
          <TextField
            label="Public key"
            value={project.publicKey}
            slotProps={{
              input: {
                readOnly: true,
                sx: { fontFamily: 'monospace' },
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="Copy public key"
                      onClick={() => {
                        void navigator.clipboard.writeText(project.publicKey).then(() => setCopied(true))
                      }}
                    >
                      <ContentCopyIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              SDK snippet
            </Typography>
            <Box
              component="pre"
              sx={{ m: 0, p: 1.5, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', fontSize: 13 }}
            >
              {`<!-- Nooted loader snippet: coming with the SDK. Project key: ${project.publicKey} -->`}
            </Box>
          </Box>
        </Stack>
      </Section>

      <Section title="Allowed origins">
        <List dense disablePadding>
          {project.origins.length === 0 && <Typography color="text.secondary">No allowed origins yet.</Typography>}
          {project.origins.map((origin) => (
            <ListItem
              key={origin}
              disableGutters
              secondaryAction={
                canManage && (
                  <IconButton aria-label={`Remove ${origin}`} edge="end" onClick={() => removeOrigin.mutate(origin)}>
                    <DeleteIcon />
                  </IconButton>
                )
              }
            >
              <ListItemText primary={origin} slotProps={{ primary: { sx: { fontFamily: 'monospace' } } }} />
            </ListItem>
          ))}
        </List>
        {removeOrigin.isError && <Alert severity="error" sx={{ mt: 1 }}>{removeOrigin.error.message}</Alert>}
        {canManage && (
          <AddField label="Origin" placeholder="https://app.example.com" buttonLabel="Add origin" mutation={addOrigin} />
        )}
      </Section>

      <Section title="Members">
        <List dense disablePadding>
          {project.members.length === 0 && <Typography color="text.secondary">No members yet.</Typography>}
          {project.members.map((member) => (
            <ListItem
              key={member.email}
              disableGutters
              secondaryAction={
                canManage && (
                  <IconButton aria-label={`Remove ${member.email}`} edge="end" onClick={() => removeMember.mutate(member.email)}>
                    <DeleteIcon />
                  </IconButton>
                )
              }
            >
              <ListItemText primary={member.email} />
              {member.pending ? (
                <Chip label="Pending" size="small" sx={{ mr: 4 }} />
              ) : (
                <Typography color="text.secondary" sx={{ mr: 4 }}>
                  {member.name}
                </Typography>
              )}
            </ListItem>
          ))}
        </List>
        {removeMember.isError && <Alert severity="error" sx={{ mt: 1 }}>{removeMember.error.message}</Alert>}
        {canManage && <AddField label="Email" type="email" buttonLabel="Add member" mutation={addMember} />}
      </Section>

      <Section title="Retention">
        <RetentionForm
          key={project.retentionDays ?? 'none'}
          retentionDays={project.retentionDays}
          canManage={canManage}
          mutation={setRetention}
        />
      </Section>

      <Snackbar open={copied} autoHideDuration={2000} onClose={() => setCopied(false)} message="Public key copied" />
    </>
  )
}

type Mutation<V> = ReturnType<typeof useProjectMutation<V>>

function NameField({ value, canManage, mutation }: { value: string; canManage: boolean; mutation: Mutation<string> }) {
  const [name, setName] = useState(value)
  return (
    <Box>
      <Stack direction="row" spacing={1}>
        <TextField
          fullWidth
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          slotProps={{ input: { readOnly: !canManage } }}
        />
        {canManage && (
          <Button
            variant="contained"
            disabled={!name.trim() || name.trim() === value || mutation.isPending}
            onClick={() => mutation.mutate(name)}
          >
            Save
          </Button>
        )}
      </Stack>
      {mutation.isError && <Alert severity="error" sx={{ mt: 1 }}>{mutation.error.message}</Alert>}
    </Box>
  )
}

function AddField({
  label,
  placeholder,
  type,
  buttonLabel,
  mutation,
}: {
  label: string
  placeholder?: string
  type?: string
  buttonLabel: string
  mutation: Mutation<string>
}) {
  const [value, setValue] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate(value, { onSuccess: () => setValue('') })
      }}
    >
      <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          label={label}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (mutation.isError) mutation.reset()
          }}
          error={mutation.isError}
          helperText={mutation.isError ? mutation.error.message : undefined}
        />
        <Button type="submit" variant="outlined" disabled={!value.trim() || mutation.isPending} sx={{ whiteSpace: 'nowrap' }}>
          {buttonLabel}
        </Button>
      </Stack>
    </form>
  )
}

function RetentionForm({
  retentionDays,
  canManage,
  mutation,
}: {
  retentionDays: number | null
  canManage: boolean
  mutation: Mutation<number | null>
}) {
  const [noLimit, setNoLimit] = useState(retentionDays === null)
  const [days, setDays] = useState(String(retentionDays ?? 90))
  const parsed = Number(days)
  const valid = noLimit || (Number.isInteger(parsed) && parsed >= 1)

  return (
    <>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <TextField
          size="small"
          type="number"
          label="Days"
          value={days}
          disabled={noLimit}
          onChange={(e) => setDays(e.target.value)}
          slotProps={{ input: { readOnly: !canManage }, htmlInput: { min: 1 } }}
        />
        <FormControlLabel
          label="No limit"
          control={<Switch checked={noLimit} disabled={!canManage} onChange={(e) => setNoLimit(e.target.checked)} />}
        />
        {canManage && (
          <Button variant="contained" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate(noLimit ? null : parsed)}>
            Save
          </Button>
        )}
      </Stack>
      {mutation.isError && <Alert severity="error" sx={{ mt: 1 }}>{mutation.error.message}</Alert>}
    </>
  )
}
