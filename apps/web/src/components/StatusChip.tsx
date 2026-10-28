import { Chip } from '@mui/material'
import type { ChipProps } from '@mui/material'
import { STATUS_LABELS, isFeedbackStatus } from '@nooted/shared/status'
import type { FeedbackStatus } from '@nooted/shared/status'

export const STATUS_COLORS: Record<FeedbackStatus, NonNullable<ChipProps['color']>> = {
  new: 'info',
  in_progress: 'warning',
  done: 'success',
  dismissed: 'default',
}

export function statusLabel(status: string): string {
  return isFeedbackStatus(status) ? STATUS_LABELS[status] : status
}

export function StatusChip({ status, ...props }: { status: string } & Omit<ChipProps, 'label' | 'color'>) {
  return <Chip size="small" {...props} label={statusLabel(status)} color={isFeedbackStatus(status) ? STATUS_COLORS[status] : 'default'} />
}
