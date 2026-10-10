import { defineConfig } from 'prisma/config';

// Load apps/api/.env if present (Node 24 built-in; no dotenv dependency needed).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the real environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
