import type { Request } from 'express';

export type RequestContext = Request & { correlationId?: string };

export type AuthPrincipal =
  | { kind: 'USER'; userId: string; permissions: string[]; roles: string[] }
  | { kind: 'COLLABORATOR'; collaboratorId: string };

export type AuthenticatedRequest = RequestContext & { principal?: AuthPrincipal };
