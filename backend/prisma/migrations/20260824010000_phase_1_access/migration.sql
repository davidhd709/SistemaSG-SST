CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CollaboratorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "users" (
  "id" UUID NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false, "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0, "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE TABLE "roles" ("id" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "roles_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE TABLE "permissions" ("id" UUID NOT NULL, "code" TEXT NOT NULL, "description" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "permissions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");
CREATE TABLE "user_roles" ("userId" UUID NOT NULL, "roleId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId", "roleId"));
CREATE TABLE "role_permissions" ("roleId" UUID NOT NULL, "permissionId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId", "permissionId"));
CREATE TABLE "refresh_sessions" ("id" UUID NOT NULL, "userId" UUID, "sessionType" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "ip" TEXT, "userAgent" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "refresh_sessions_tokenHash_key" ON "refresh_sessions"("tokenHash");
CREATE INDEX "refresh_sessions_userId_expiresAt_idx" ON "refresh_sessions"("userId", "expiresAt");
CREATE TABLE "collaborators" ("id" UUID NOT NULL, "documentType" TEXT NOT NULL, "documentNumber" TEXT NOT NULL, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "email" TEXT, "phone" TEXT, "jobTitle" TEXT, "team" TEXT, "pinHash" TEXT NOT NULL, "status" "CollaboratorStatus" NOT NULL DEFAULT 'ACTIVE', "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0, "lockedUntil" TIMESTAMP(3), "createdById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "collaborators_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "collaborators_documentNumber_key" ON "collaborators"("documentNumber");
CREATE INDEX "collaborators_status_idx" ON "collaborators"("status");
CREATE TABLE "audit_events" ("id" UUID NOT NULL, "actorUserId" UUID, "actorCollaboratorId" UUID, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "beforeJson" JSONB, "afterJson" JSONB, "reason" TEXT, "ip" TEXT, "userAgent" TEXT, "correlationId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"));
CREATE INDEX "audit_events_entityType_entityId_createdAt_idx" ON "audit_events"("entityType", "entityId", "createdAt");
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaborators" ADD CONSTRAINT "collaborators_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorCollaboratorId_fkey" FOREIGN KEY ("actorCollaboratorId") REFERENCES "collaborators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
