import { stopApi } from './apiServer';

export default async function globalTeardown(): Promise<void> {
  await stopApi();
}
