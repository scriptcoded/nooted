import { Chip, Link, styled } from '@mui/material'
import { createLink } from '@tanstack/react-router'
import { splitNote } from '@nooted/shared/note'

interface NoteTextProps {
  note: string
  /** Makes `[n]` chips clickable. Without it they are inert. */
  onRef?: (n: number) => void
  /** Reference numbers that exist; other `[n]` tokens stay plain text. All are chips when omitted. */
  available?: readonly number[]
}

// A note with its [n] tokens drawn as small chips.
export function NoteText({ note, onRef, available }: NoteTextProps) {
  return (
    <>
      {splitNote(note).map((part, i) => {
        if ('text' in part) return part.text
        const { ref } = part
        if (available && !available.includes(ref)) return `[${ref}]`
        return (
          <Chip
            key={i}
            label={ref}
            size="small"
            color="primary"
            variant="outlined"
            component={onRef ? 'button' : 'span'}
            clickable={Boolean(onRef)}
            onClick={onRef ? () => onRef(ref) : undefined}
            aria-label={onRef ? `Capture ${ref}` : undefined}
            data-testid="note-ref"
            data-ref={ref}
            sx={{
              height: 20,
              mx: 0.25,
              verticalAlign: 'baseline',
              fontWeight: 600,
              fontSize: '0.75rem',
              transform: 'translateY(-1px)',
              '& .MuiChip-label': { px: 0.75 },
              ...(onRef ? {} : { pointerEvents: 'none' }),
            }}
          />
        )
      })}
    </>
  )
}

export const noteSx = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const

/** MUI link typography as a type-safe router link. */
export const MuiRouterLink = createLink(Link)

export const NoteLinkAnchor = styled('a')(({ theme }) => ({
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  color: (theme.vars ?? theme).palette.text.primary,
  textDecoration: 'none',
  fontWeight: 500,
  fontSize: theme.typography.body2.fontSize,
  lineHeight: theme.typography.body2.lineHeight,
  '&:hover': { color: (theme.vars ?? theme).palette.primary.main },
}))
export const NoteRouterLink = createLink(NoteLinkAnchor)
