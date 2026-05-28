import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/domain',
  'packages/protocol',
  'apps/server-gateway',
  'apps/server-channel',
  'apps/client',
]);
