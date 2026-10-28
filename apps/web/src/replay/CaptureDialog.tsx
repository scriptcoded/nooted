import { useRef, useState } from 'react'
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import ZoomInMapOutlinedIcon from '@mui/icons-material/ZoomInMapOutlined'
import ZoomOutMapOutlinedIcon from '@mui/icons-material/ZoomOutMapOutlined'
import { formatClock, pagePath } from '../format.ts'
import { CapturePlayer, type PlayerCapture, type PlayerHandle } from './CapturePlayer.tsx'
import { useCaptureEvents } from './useCaptureEvents.ts'

export interface DialogCapture extends PlayerCapture {
  url: string
  marks: (PlayerCapture['marks'][number] & { name?: string; role?: string; text: string; tag: string; selector: string })[]
}

interface CaptureDialogProps {
  projectId: string
  itemId: string
  capture: DialogCapture
  open: boolean
  onClose: () => void
}

export function captureTitle(capture: DialogCapture): string {
  if (capture.demo) return `Recording · ${formatClock(capture.durationMs)}`
  if (capture.marks.length === 0) return 'Pointed at the whole page'
  return `Pointed at ${capture.marks.map((m) => m.name || m.text || m.tag).join(', ')}`
}

export function CaptureDialog({ projectId, itemId, capture, open, onClose }: CaptureDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth aria-labelledby={`capture-dialog-title-${capture.n}`}>
      {open && <DialogBody projectId={projectId} itemId={itemId} capture={capture} onClose={onClose} />}
    </Dialog>
  )
}

function DialogBody({ projectId, itemId, capture, onClose }: Omit<CaptureDialogProps, 'open'>) {
  const events = useCaptureEvents(projectId, itemId, capture.n, true)
  const handle = useRef<PlayerHandle>(null)
  const [zoomed, setZoomed] = useState(true)
  const [playing, setPlaying] = useState(false)
  const canZoom = !capture.demo && capture.marks.length > 0

  return (
    <>
      <DialogTitle id={`capture-dialog-title-${capture.n}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 7 }}>
        <Chip label={capture.n} color="primary" variant="outlined" size="small" sx={{ fontWeight: 700 }} />
        <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '1.1rem' }}>
          {captureTitle(capture)}
        </Box>
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <CapturePlayer
          ref={handle}
          large
          capture={capture}
          events={events.data}
          failed={events.isError}
          zoomed={zoomed}
          onPlayingChange={setPlaying}
        />
        <Stack direction="row" spacing={1.5} sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          {capture.demo && (
            <Button
              variant="contained"
              size="small"
              disabled={!events.data}
              startIcon={playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
              onClick={() => handle.current?.toggle()}
            >
              {playing ? 'Pause' : 'Play'}
            </Button>
          )}
          {canZoom && (
            <Button
              variant="outlined"
              size="small"
              startIcon={zoomed ? <ZoomOutMapOutlinedIcon /> : <ZoomInMapOutlinedIcon />}
              onClick={() => setZoomed((z) => !z)}
            >
              {zoomed ? 'Show whole page' : 'Zoom to selection'}
            </Button>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto !important', overflowWrap: 'anywhere' }}>
            {pagePath(capture.url)}
          </Typography>
        </Stack>
      </DialogContent>
    </>
  )
}
