export type Role =
  | 'SUPER_ADMIN'
  | 'CPSE_ADMIN'
  | 'MATERIAL_EXPERT'
  | 'PROCUREMENT_OFFICER'
  | 'AUDITOR'
  | 'VIEWER';

export type Permission =
  | 'review'
  | 'l2'
  | 'settings'
  | 'upload'
  | 'audit_view'
  | 'procurement_view';

export interface RoleDefinition {
  label: string;
  desc: string;
  permissions: Permission[];
}

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  SUPER_ADMIN: {
    label: 'Super administrator',
    desc: 'Platform governance, configuration, and second-level approval.',
    permissions: ['review', 'l2', 'settings', 'upload', 'audit_view', 'procurement_view'],
  },
  CPSE_ADMIN: {
    label: 'CPSE administrator',
    desc: 'Uploads and reviews data for one CPSE. Other CPSEs’ codes are masked.',
    permissions: ['review', 'upload', 'procurement_view'],
  },
  MATERIAL_EXPERT: {
    label: 'Material expert',
    desc: 'Reviews matches, standard descriptions, and attributes.',
    permissions: ['review', 'procurement_view'],
  },
  PROCUREMENT_OFFICER: {
    label: 'Procurement officer',
    desc: 'Read-only access to mappings and procurement opportunities.',
    permissions: ['procurement_view'],
  },
  AUDITOR: {
    label: 'Auditor',
    desc: 'Read-only access to decisions, lineage, and the audit log.',
    permissions: ['audit_view', 'procurement_view'],
  },
  VIEWER: {
    label: 'Viewer',
    desc: 'Read-only access to approved national materials.',
    permissions: [],
  },
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId?: string;
  permissions: Permission[];
}

export interface TokenPayload {
  sub: string;
  name: string;
  email: string;
  role: Role;
  tenantId?: string;
  permissions: Permission[];
  iat?: number;
  exp?: number;
}
