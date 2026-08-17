import { Router } from 'express';

export function createHealthRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return router;
}
