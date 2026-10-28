import { useEffect, useRef, useState } from 'react'
import { Box, Chip, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { absoluteTime, formatClock, pagePath } from '../format.ts'
import { CapturePlayer } from '../replay/CapturePlayer.tsx'
import { CaptureDialog, type DialogCapture } from '../replay/CaptureDialog.tsx'
import { useCaptureEvents } from '../replay/useCaptureEvents.ts'

interface CaptureCardProps {
  projectId: string
  itemId: string
  capture: DialogCapture & { capturedAt: string | number }
  highlighted: boolean
  onCopy: (selector: string) => void
}

export function CaptureCard({ projectId, itemId, capture, highlighted, onCopy }: CaptureCardProps) {
  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Events (and with them the player) are only requested once the card is near the viewport.
  useEffect(() => {
    const el = root.current
    if (!el) return
    if (typeof IntersectionObserver !== 'function') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const events = useCaptureEvents(projectId, itemId, capture.n, visible)

  return (
    <Paper
      ref={root}
      id={`capture-${capture.n}`}
      data-testid="capture-card"
      data-highlighted={highlighted ? 'true' : undefined}
      variant="outlined"
      sx={{
        p: 2,
        display: 'flex',
        gap: 2.5,
        flexDirection: { xs: 'column', sm: 'row' },
        scrollMarginTop: 16,
        transition: 'box-shadow 400ms ease, border-color 400ms ease',
        ...(highlighted && {
          borderColor: 'primary.main',
          boxShadow: (t) => `0 0 0 4px color-mix(in srgb, ${t.vars?.palette.primary.main ?? t.palette.primary.main} 35%, transparent)`,
        }),
      }}
    >
      <Box sx={{ width: { xs: '100%', sm: 240 }, flexShrink: 0 }}>
        <Box
          component="button"
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open capture ${capture.n}`}
          data-testid="capture-open"
          sx={{
            display: 'block',
            width: '100%',
            p: 0,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
            cursor: 'zoom-in',
            bgcolor: 'transparent',
            transition: 'box-shadow 150ms',
            '&:hover': { boxShadow: 3 },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          }}
        >
          <CapturePlayer capture={capture} events={events.data} failed={events.isError} />
        </Box>
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <Chip label={capture.n} size="small" color="primary" variant="outlined" sx={{ fontWeight: 700 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {capture.demo ? `Recording · ${formatClock(capture.durationMs)}` : 'Pointed at'}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere', mb: 1.5 }}>
          <Tooltip title={capture.url}>
            <span>{pagePath(capture.url)}</span>
          </Tooltip>
          {' · '}
          {absoluteTime(capture.capturedAt)}
        </Typography>
        {!capture.demo &&
          (capture.marks.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Whole page
            </Typography>
          ) : (
            <Stack spacing={1.25} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {capture.marks.map((m, i) => (
                <ElementRow key={i} mark={m} onCopy={onCopy} />
              ))}
            </Stack>
          ))}
      </Box>
      <CaptureDialog projectId={projectId} itemId={itemId} capture={capture} open={open} onClose={() => setOpen(false)} />
    </Paper>
  )
}

function ElementRow({ mark, onCopy }: { mark: DialogCapture['marks'][number]; onCopy: (s: string) => void }) {
  const title = mark.name || mark.text || mark.tag
  const excerpt = mark.text && mark.text !== mark.name ? mark.text : ''
  return (
    <Box component="li" data-testid="capture-element" sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {mark.role && <Chip label={mark.role} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />}
      </Stack>
      {excerpt && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
        >
          {excerpt}
        </Typography>
      )}
      {mark.selector && (
        <Stack direction="row" sx={{ alignItems: 'center', mt: 0.25, minWidth: 0 }}>
          <Typography
            component="code"
            variant="caption"
            data-testid="capture-selector"
            sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'text.secondary', overflowWrap: 'anywhere', minWidth: 0 }}
          >
            {mark.selector}
          </Typography>
          <Tooltip title="Copy selector">
            <IconButton size="small" aria-label="Copy selector" onClick={() => onCopy(mark.selector)} sx={{ ml: 0.25 }}>
              <ContentCopyIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    </Box>
  )
}
