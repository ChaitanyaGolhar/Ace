import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './testDb';

/** Applies migrations to the test database once before the API tests run. */
export default function setup(): void {
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'pipe',
    });
  } catch (error) {
    const output = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
    throw new Error(
      `Could not migrate the test database at ${TEST_DATABASE_URL}.\n` +
        `Is Postgres running? Start it with: docker compose up -d\n${output}`,
      { cause: error },
    );
  }
}
