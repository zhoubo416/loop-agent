import type { Db } from '../db/client.js'
import { listOpenActions, listProposedActions } from './actions.js'
import { listRecommendations } from './recommendations.js'
import { getState } from './states.js'
import { getTimeline } from './timeline.js'
import type { ProjectRow } from './access.js'
import { listStateProposals } from './state-proposals.js'

export interface Overview {
  project: {
    id: string
    name: string
    objective: string
    description: string | null
    status: string
    success_criteria: unknown
  }
  state: {
    current_stage: string | null
    current_situation: string | null
    version: number
    updated_at: Date | string
  }
  open_issues: unknown[]
  risks: unknown[]
  unknowns: unknown[]
  active_actions: Array<{ id: string; title: string; priority: string; status: string; assignee_id: string | null }>
  recommendations: Array<{
    id: string
    type: string
    content: string
    priority: string
    created_at: Date | string
  }>
  recent_activity: Array<{ id: string; type: string; title: string; created_at: Date | string }>
  proposed_actions: Array<{ id: string; title: string; priority: string; created_at: Date | string }>
  state_proposals: Array<{
    id: string
    proposal: unknown
    created_at: Date | string
  }>
}

export async function getOverview(db: Db, project: ProjectRow): Promise<Overview> {
  const state = await getState(db, project.id)
  const [actions, proposedActions, recommendations, timeline, stateProposals] = await Promise.all([
    listOpenActions(db, project.id),
    listProposedActions(db, project.id),
    listRecommendations(db, project.id, { status: 'pending', limit: 5 }),
    getTimeline(db, project.id, 10),
    listStateProposals(db, project.id, { status: 'pending', limit: 5 }),
  ])

  return {
    project: {
      id: project.id,
      name: project.name,
      objective: project.objective,
      description: project.description,
      status: project.status,
      success_criteria: project.success_criteria,
    },
    state: {
      current_stage: state.current_stage,
      current_situation: state.current_situation,
      version: state.version,
      updated_at: state.updated_at,
    },
    open_issues: Array.isArray(state.open_issues) ? state.open_issues : [],
    risks: Array.isArray(state.risks) ? state.risks : [],
    unknowns: Array.isArray(state.unknowns) ? state.unknowns : [],
    active_actions: actions.map((action) => ({
      id: action.id,
      title: action.title,
      priority: action.priority,
      status: action.status,
      assignee_id: action.assignee_id,
    })),
    recommendations: recommendations.map((item) => ({
      id: item.id,
      content: item.content,
      type: item.type,
      priority: item.priority,
      created_at: item.created_at,
    })),
    proposed_actions: proposedActions.map((action) => ({
      id: action.id,
      title: action.title,
      priority: action.priority,
      created_at: action.created_at,
    })),
    state_proposals: stateProposals.map((proposal) => ({
      id: proposal.id,
      proposal: proposal.proposal,
      created_at: proposal.created_at,
    })),
    recent_activity: timeline.items.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      created_at: item.created_at,
    })),
  }
}
