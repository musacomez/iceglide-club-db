import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './wrangler.test.jsonc',
      },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(process.cwd(), 'migrations'),
          ),
        },
      },
    }),
  ],

  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],

    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
