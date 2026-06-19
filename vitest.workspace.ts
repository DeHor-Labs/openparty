import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/protocol/vitest.config.ts',
  'apps/server/vitest.config.ts',
  'apps/web/vitest.config.ts',
])
