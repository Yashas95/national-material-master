import { Router, Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { authenticate } from '../middleware/authMiddleware';
import { Role, ROLE_DEFINITIONS } from '../models/auth';

export const authRouter = Router();

authRouter.post('/auth/login', (req: Request, res: Response) => {
  const { role = 'SUPER_ADMIN', tenantId = 'A' } = req.body as { role?: Role; tenantId?: string };

  if (!ROLE_DEFINITIONS[role]) {
    res.status(400).json({ status: 'error', message: `Invalid role: ${role}` });
    return;
  }

  const result = AuthService.loginAsRole(role, tenantId);
  res.status(200).json({
    status: 'success',
    data: result,
  });
});

authRouter.get('/auth/me', authenticate, (req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    data: {
      user: req.user,
      tenantScope: req.tenantScope || null,
      availableRoles: Object.keys(ROLE_DEFINITIONS),
    },
  });
});

authRouter.post('/auth/switch-role', (req: Request, res: Response) => {
  const { role, tenantId = 'A' } = req.body as { role: Role; tenantId?: string };

  if (!ROLE_DEFINITIONS[role]) {
    res.status(400).json({ status: 'error', message: `Invalid role: ${role}` });
    return;
  }

  const result = AuthService.loginAsRole(role, tenantId);
  res.status(200).json({
    status: 'success',
    data: result,
  });
});
