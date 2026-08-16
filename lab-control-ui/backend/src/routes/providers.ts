import { Router } from 'express';
import { listProviders } from '../providers/registry.js';
import { toPublicShape } from '../providers/types.js';

export function createProvidersRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ providers: listProviders().map(toPublicShape) });
  });

  return router;
}
