import { ApiError } from '../http/errors.js'

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week(0 = 周日)
]

function parseField(field: string, index: number): Set<number> {
  const [min, max] = FIELD_RANGES[index]!
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1
    if (!Number.isFinite(step) || step <= 0) {
      throw new ApiError('SCHEDULE_INVALID', `非法的 cron 步长:${part}`)
    }
    let start: number
    let end: number
    if (!rangePart || rangePart === '*') {
      start = min
      end = max
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-')
      start = Number.parseInt(a ?? '', 10)
      end = Number.parseInt(b ?? '', 10)
    } else {
      start = Number.parseInt(rangePart, 10)
      end = stepPart ? max : start
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end) {
      throw new ApiError('SCHEDULE_INVALID', `非法的 cron 字段:${part}`)
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

export interface CronExpression {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
  dayOfMonthRestricted: boolean
  dayOfWeekRestricted: boolean
}

export function parseCron(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new ApiError('SCHEDULE_INVALID', `cron 表达式需要 5 个字段:${expression}`)
  }
  return {
    minutes: parseField(fields[0]!, 0),
    hours: parseField(fields[1]!, 1),
    daysOfMonth: parseField(fields[2]!, 2),
    months: parseField(fields[3]!, 3),
    daysOfWeek: parseField(fields[4]!, 4),
    dayOfMonthRestricted: fields[2] !== '*',
    dayOfWeekRestricted: fields[4] !== '*',
  }
}

export function nextCronTime(expression: string, from: Date = new Date()): Date {
  const cron = parseCron(expression)
  const cursor = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000)
  const limit = new Date(cursor.getTime() + 366 * 24 * 60 * 60 * 1000)

  while (cursor <= limit) {
    if (
      cron.minutes.has(cursor.getUTCMinutes()) &&
      cron.hours.has(cursor.getUTCHours()) &&
      cron.months.has(cursor.getUTCMonth() + 1) &&
      matchDay(cron, cursor)
    ) {
      return cursor
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
  }
  throw new ApiError('SCHEDULE_INVALID', `找不到下次执行时间:${expression}`)
}

function matchDay(cron: CronExpression, date: Date): boolean {
  const domMatch = cron.daysOfMonth.has(date.getUTCDate())
  const dowMatch = cron.daysOfWeek.has(date.getUTCDay())
  if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) return domMatch || dowMatch
  if (cron.dayOfMonthRestricted) return domMatch
  if (cron.dayOfWeekRestricted) return dowMatch
  return true
}

const DURATION_UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
}

export function parseDuration(expression: string): number {
  const match = /^(\d+)([smhd])$/.exec(expression.trim())
  if (!match) {
    throw new ApiError('SCHEDULE_INVALID', `非法的间隔表达式:${expression},示例:30m / 6h / 1d`)
  }
  return Number.parseInt(match[1]!, 10) * DURATION_UNITS[match[2]!]!
}

export function computeNextRun(
  type: string,
  expression: string | null,
  from: Date = new Date(),
): Date | null {
  switch (type) {
    case 'cron': {
      if (!expression) throw new ApiError('SCHEDULE_INVALID', 'cron 类型必须提供 expression')
      return nextCronTime(expression, from)
    }
    case 'interval': {
      if (!expression) throw new ApiError('SCHEDULE_INVALID', 'interval 类型必须提供 expression')
      return new Date(from.getTime() + parseDuration(expression))
    }
    case 'once':
      return expression ? new Date(expression) : null
    case 'event':
    case 'manual':
      return null
    default:
      throw new ApiError('SCHEDULE_INVALID', `不支持的 Schedule 类型:${type}`)
  }
}
