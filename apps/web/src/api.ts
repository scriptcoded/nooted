import { hc } from 'hono/client'
import type { AppType } from '@nooted/server'

export const api = hc<AppType>('/').api
