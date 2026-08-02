// Shared AI engine configuration — single source of truth for admin panel and user app.
// Admin writes via PUT /api/admin/scc/ai (which calls cacheDel('ai_config')); the user app
// reads it here so every admin slider/flag has a real effect on suggestions.
import { cacheGet, cacheSet } from './middleware'

export interface AiConfig {
  version: string
  sliders: { stress_sensitivity: number; adaptation_speed: number; hr_weight: number; history_weight: number; exploration: number }
  flags: { auto_pacing: boolean; hrv_coherence: boolean; cross_session: boolean; emotion_ambience: boolean; llm_guidance: boolean }
}

export const AI_DEFAULTS: AiConfig = {
  version: 'aura-2.4.1',
  sliders: { stress_sensitivity: 0.68, adaptation_speed: 0.45, hr_weight: 0.72, history_weight: 0.34, exploration: 0.12 },
  flags: { auto_pacing: true, hrv_coherence: true, cross_session: true, emotion_ambience: false, llm_guidance: false },
}

export async function getAiConfig(db: D1Database): Promise<AiConfig> {
  const cached = cacheGet<AiConfig>('ai_config')
  if (cached) return cached
  const row = await db.prepare("SELECT value FROM app_config WHERE key = 'ai_config'").first<{ value: string }>()
  let cfg = AI_DEFAULTS
  if (row) {
    try {
      const v = JSON.parse(row.value)
      cfg = { ...AI_DEFAULTS, ...v, sliders: { ...AI_DEFAULTS.sliders, ...v.sliders }, flags: { ...AI_DEFAULTS.flags, ...v.flags } }
    } catch { /* keep defaults */ }
  }
  cacheSet('ai_config', cfg, 60)
  return cfg
}
