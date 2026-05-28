import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/domain',
  'apps/server-gateway',
]);
