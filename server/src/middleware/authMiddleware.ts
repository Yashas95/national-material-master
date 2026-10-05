import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { AuthUser, Permission, Role } from '../models/auth';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      tenantScope?: string;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = AuthService.verifyAccessToken(token);
      req.user = {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
        permissions: payload.permissions,
      };
      if (req.user.role === 'CPSE_ADMIN' && req.user.tenantId) {
        req.tenantScope = req.user.tenantId;
      }
      return next();
    } catch (err) {
      res.status(401).json({ status: 'error', message: 'Invalid or expired authorization token' });
      return;
    }
  }

  const demoRole = req.headers['x-demo-role'] as Role | undefined;
  const demoTenant = (req.headers['x-demo-tenant'] as string) || 'A';

  if (demoRole) {
    const login = AuthService.loginAsRole(demoRole, demoTenant);
    req.user = login.user;
    if (login.user.role === 'CPSE_ADMIN') {
      req.tenantScope = demoTenant;
    }
    return next();
  }

  const guest = AuthService.loginAsRole('VIEWER');
  req.user = guest.user;
  return next();
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: 'error', message: 'Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        status: 'error',
        message: `Forbidden: Action requires one of roles [${allowedRoles.join(', ')}]. Current role: ${req.user.role}`,
      });
      return;
    }

    next();
  };
}

export function requirePermission(...requiredPermissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: 'error', message: 'Authentication required' });
      return;
    }

    const hasAll = requiredPermissions.every(p => req.user!.permissions.includes(p));
    if (!hasAll) {
      res.status(403).json({
        status: 'error',
        message: `Forbidden: User lacks required permissions [${requiredPermissions.join(', ')}]`,
      });
      return;
    }

    next();
  };
}
