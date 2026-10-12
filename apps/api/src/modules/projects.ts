import { ApiError } from '../http/errors.js'
import type { Db } from '../db/client.js'
import type { ProjectRow } from './access.js'

export interface CreateProjectInput {
  name: string
  objective: string
  description?: string
  successCriteria?: unknown
  constraints?: unknown
}

export async function createProject(
  db: Db,
  input: CreateProjectInput,
  actorId: string,
): Promise<ProjectRow> {
  return db.transaction(async (tx) => {
    const created = await tx.query<ProjectRow>(
      `INSERT INTO projects (name, objective, description, success_criteria, constraints, status, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'created', $6)
       RETURNING *`,
      [
        input.name,
        input.objective,
        input.description ?? null,
        JSON.stringify(input.successCriteria ?? []),
        JSON.stringify(input.constraints ?? {}),
        actorId,
      ],
    )
    const project = created.rows[0]!

    await tx.query(
      `INSERT INTO project_users (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [project.id, actorId],
    )
    await tx.query(
      `INSERT INTO agent_states (project_id, current_stage, current_situation)
       VALUES ($1, '未开始', 'Project 刚创建,还没有任何 Observation。')`,
      [project.id],
    )
    await tx.query(
      `INSERT INTO agent_state_versions (project_id, state_id, version, state, changed_by_type, changed_by_id)
       SELECT project_id, id, version,
              jsonb_build_object(
                'current_stage', current_stage,
                'current_situation', current_situation,
                'open_issues', open_issues,
                'active_actions', active_actions,
                'risks', risks,
                'unknowns', unknowns,
                'context', context
              ),
              'user', $2
       FROM agent_states WHERE project_id = $1`,
      [project.id, actorId],
    )
    return project
  })
}

export interface ListProjectsQuery {
  page: number
  pageSize: number
  status?: string
}

export interface ProjectListItem {
  id: string
  name: string
  objective: string
  status: string
  current_stage: string | null
  updated_at: Date | string
  role: string
}

export async function listProjects(
  db: Db,
  userId: string,
  query: ListProjectsQuery,
): Promise<{ items: ProjectListItem[]; total: number }> {
  const params: unknown[] = [userId]
  let where = 'WHERE pu.user_id = $1'
  if (query.status) {
    params.push(query.status)
    where += ` AND p.status = $${params.length}`
  }

  const totalResult = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM projects p JOIN project_users pu ON pu.project_id = p.id
     ${where}`,
    params,
  )

  params.push(query.pageSize, (query.page - 1) * query.pageSize)
  const items = await db.query<ProjectListItem>(
    `SELECT p.id, p.name, p.objective, p.status, p.current_stage, p.updated_at, pu.role
     FROM projects p
     JOIN project_users pu ON pu.project_id = p.id
     ${where}
     ORDER BY p.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  return { items: items.rows, total: Number.parseInt(totalResult.rows[0]?.count ?? '0', 10) }
}

export interface UpdateProjectInput {
  name?: string
  objective?: string
  description?: string | null
  successCriteria?: unknown
  constraints?: unknown
}

export async function updateProject(
  db: Db,
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectRow> {
  const sets: string[] = []
  const params: unknown[] = [projectId]

  const push = (column: string, value: unknown, cast = '') => {
    params.push(value)
    sets.push(`${column} = $${params.length}${cast}`)
  }

  if (input.name !== undefined) push('name', input.name)
  if (input.objective !== undefined) push('objective', input.objective)
  if (input.description !== undefined) push('description', input.description)
  if (input.successCriteria !== undefined) {
    push('success_criteria', JSON.stringify(input.successCriteria), '::jsonb')
  }
  if (input.constraints !== undefined) push('constraints', JSON.stringify(input.constraints), '::jsonb')

  if (sets.length === 0) {
    const current = await db.query<ProjectRow>('SELECT * FROM projects WHERE id = $1', [projectId])
    const row = current.rows[0]
    if (!row) throw new ApiError('PROJECT_NOT_FOUND', 'Project 不存在')
    return row
  }

  sets.push('updated_at = now()')
  const updated = await db.query<ProjectRow>(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  const row = updated.rows[0]
  if (!row) throw new ApiError('PROJECT_NOT_FOUND', 'Project 不存在')
  return row
}

export async function setProjectStatus(
  db: Db,
  projectId: string,
  status: 'created' | 'active' | 'paused' | 'completed' | 'archived',
): Promise<ProjectRow> {
  const result = await db.query<ProjectRow>(
    `UPDATE projects
     SET status = $2::varchar,
         updated_at = now(),
         archived_at = CASE WHEN $2::varchar = 'archived' THEN now() ELSE archived_at END
     WHERE id = $1
     RETURNING *`,
    [projectId, status],
  )
  const row = result.rows[0]
  if (!row) throw new ApiError('PROJECT_NOT_FOUND', 'Project 不存在')
  return row
}

export interface MemberItem {
  user_id: string
  name: string
  email: string | null
  role: string
  joined_at: Date | string
}

export async function listMembers(db: Db, projectId: string): Promise<MemberItem[]> {
  const result = await db.query<MemberItem>(
    `SELECT pu.user_id, u.name, u.email, pu.role, pu.joined_at
     FROM project_users pu
     JOIN users u ON u.id = pu.user_id
     WHERE pu.project_id = $1
     ORDER BY pu.joined_at`,
    [projectId],
  )
  return result.rows
}

export async function addMember(
  db: Db,
  projectId: string,
  userId: string,
  role: string,
): Promise<MemberItem> {
  const user = await db.query<{ id: string; name: string; email: string | null }>(
    'SELECT id, name, email FROM users WHERE id = $1',
    [userId],
  )
  if (!user.rows[0]) throw new ApiError('USER_NOT_FOUND', '用户不存在')

  const result = await db.query<MemberItem>(
    `INSERT INTO project_users (project_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING user_id, role, joined_at`,
    [projectId, userId, role],
  )
  const row = result.rows[0]!
  return { ...row, name: user.rows[0].name, email: user.rows[0].email }
}

export async function updateMemberRole(
  db: Db,
  projectId: string,
  userId: string,
  role: string,
): Promise<void> {
  const result = await db.query(
    'UPDATE project_users SET role = $3 WHERE project_id = $1 AND user_id = $2',
    [projectId, userId, role],
  )
  if (result.rowCount === 0) throw new ApiError('USER_NOT_FOUND', '该用户不是 Project 成员')
}

export async function removeMember(db: Db, projectId: string, userId: string): Promise<void> {
  const owners = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM project_users WHERE project_id = $1 AND role = 'owner'`,
    [projectId],
  )
  const membership = await db.query<{ role: string }>(
    'SELECT role FROM project_users WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  )
  const current = membership.rows[0]
  if (!current) throw new ApiError('USER_NOT_FOUND', '该用户不是 Project 成员')

  if (current.role === 'owner' && Number.parseInt(owners.rows[0]?.count ?? '0', 10) <= 1) {
    throw new ApiError('VALIDATION_ERROR', '不能移除唯一的 owner')
  }
  await db.query('DELETE FROM project_users WHERE project_id = $1 AND user_id = $2', [projectId, userId])
}
