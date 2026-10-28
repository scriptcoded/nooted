export const FEEDBACK_STATUSES = ['new', 'in_progress', 'done', 'dismissed'] as const

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(v)
}

export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  done: 'Done',
  dismissed: 'Dismissed',
}
