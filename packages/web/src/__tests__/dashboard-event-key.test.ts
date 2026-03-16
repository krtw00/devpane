import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * Dashboard.vue の recentEvents v-for キーが
 * 配列インデックスではなく e.id を使用していることを検証する。
 * TDD: 実装前はFAILする。
 */
describe('Dashboard recentEvents v-for key', () => {
  const template = readFileSync(
    resolve(__dir, '../views/Dashboard.vue'),
    'utf-8',
  )

  it('v-for は :key="e.id" を使用する', () => {
    const vForLine = template
      .split('\n')
      .find((line: string) => line.includes('recentEvents') && line.includes('v-for'))

    expect(vForLine).toBeDefined()
    expect(vForLine).toContain(':key="e.id"')
    expect(vForLine).not.toMatch(/v-for="\(e,\s*i\)/)
  })
})
