import { Router } from 'express';
import type { AppDeps } from '../app';

export function syncRoutes(_deps: AppDeps): Router {
  return Router();
}
