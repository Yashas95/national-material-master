import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { AuthUser, Role, ROLE_DEFINITIONS, TokenPayload } from '../models/auth';

const DEMO_PERSONAS: Record<Role, { name: string; email: string }> = {
  SUPER_ADMIN: { name: 'Dr. V. Sharma', email: 'superadmin@nummf.gov.in' },
  CPSE_ADMIN: { name: 'R. K. Verma', email: 'admin@petro.gov.in' },
  MATERIAL_EXPERT: { name: 'R. Iyer', email: 'r.iyer@nummf.gov.in' },
  PROCUREMENT_OFFICER: { name: 'S. Banerjee', email: 'banerjee@nummf.gov.in' },
  AUDITOR: { name: 'K. Menon (CAG Auditor)', email: 'menon@cag.gov.in' },
  VIEWER: { name: 'Public Auditor / Citizen Viewer', email: 'viewer@nic.in' },
};

export class AuthService {
  static signAccessToken(user: AuthUser): string {
    const payload: TokenPayload = {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      permissions: user.permissions,
    };

    return jwt.sign(payload, config.auth.jwtSecret, {
      expiresIn: config.auth.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    });
  }

  static signRefreshToken(user: AuthUser): string {
    return jwt.sign(
      { sub: user.id, role: user.role, tenantId: user.tenantId },
      config.auth.refreshTokenSecret,
      { expiresIn: config.auth.refreshTokenExpiresIn as jwt.SignOptions['expiresIn'] }
    );
  }

  static verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, config.auth.jwtSecret) as TokenPayload;
  }

  static loginAsRole(role: Role, tenantId = 'A'): { user: AuthUser; accessToken: string; refreshToken: string } {
    const persona = DEMO_PERSONAS[role] || DEMO_PERSONAS.VIEWER;
    const permissions = ROLE_DEFINITIONS[role]?.permissions || [];

    const user: AuthUser = {
      id: `usr_${role.toLowerCase()}_${tenantId.toLowerCase()}`,
      name: persona.name,
      email: persona.email,
      role,
      tenantId: role === 'CPSE_ADMIN' ? tenantId : undefined,
      permissions,
    };

    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user);

    return { user, accessToken, refreshToken };
  }
}
