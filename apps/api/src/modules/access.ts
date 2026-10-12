import { ApiError } from '../http/errors.js'
import type { Db, Row } from '../db/client.js'

export interface ProjectRow extends Row {
  id: string
  name: string
  objective: string
  description: string | null
  success_criteria: unknown
  constraints: unknown
  status: string
  current_stage: string | null
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  archived_at: Date | string | null
}

export interface MemberRole {
  role: string
}

const roleRank: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 }

export async function findMembership(
  db: Db,
  projectId: string,
  userId: string,
): Promise<MemberRole | undefined> {
  const result = await db.query<MemberRole>(
    'SELECT role FROM project_users WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  )
  return result.rows[0]
}

/**
 * Project 是数据隔离边界:不是成员就看不到任何 Project 级数据。
 * 对应 docs/design/02-database-design.md 第 23 节。
 */
export async function requireProjectAccess(
  db: Db,
  projectId: string,
  userId: string,
  minRole: 'viewer' | 'member' | 'admin' | 'owner' = 'viewer',
): Promise<ProjectRow> {
  const project = await db.query<ProjectRow>('SELECT * FROM projects WHERE id = $1', [projectId])
  const row = project.rows[0]
  if (!row) throw new ApiError('PROJECT_NOT_FOUND', 'Project 不存在')

  const membership = await findMembership(db, projectId, userId)
  if (!membership) throw new ApiError('PROJECT_ACCESS_DENIED', '当前用户不是该 Project 成员')
  if ((roleRank[membership.role] ?? 0) < (roleRank[minRole] ?? 0)) {
    throw new ApiError('PROJECT_ACCESS_DENIED', '当前用户角色权限不足')
  }
  return row
}

export function assertProjectAcceptsInput(project: ProjectRow, allowPaused = false): void {
  if (project.status === 'completed' || project.status === 'archived') {
    throw new ApiError('PROJECT_COMPLETED', 'Project 已结束,不再接受新的触发')
  }
  if (project.status === 'paused' && !allowPaused) {
    throw new ApiError('PROJECT_PAUSED', 'Project 已暂停,不接受自动触发')
  }
}
