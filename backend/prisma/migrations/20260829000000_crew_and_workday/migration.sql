-- El permiso de trabajo en altura pasa de ser individual a ser de cuadrilla, y
-- de ser un envío puntual a ser una jornada con apertura y cierre.
--
-- Los envíos que ya existen se conservan: cada uno se convierte en una cuadrilla
-- de un solo integrante —su colaborador actual, marcado como responsable— y su
-- firma queda asociada a ese integrante.

-- ── 1. Catálogo de cargos ──────────────────────────────────────────────
CREATE TABLE "job_positions" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "canLead"   BOOLEAN NOT NULL DEFAULT false,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_positions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_positions_code_key" ON "job_positions"("code");

-- ── 2. Planillas de seguridad social ───────────────────────────────────
CREATE TABLE "social_security_payrolls" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "reference"    TEXT NOT NULL,
  "providerName" TEXT,
  "periodStart"  DATE NOT NULL,
  "periodEnd"    DATE NOT NULL,
  "fileId"       UUID,
  "createdById"  UUID,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_security_payrolls_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "social_security_payrolls_periodEnd_idx" ON "social_security_payrolls"("periodEnd");
ALTER TABLE "social_security_payrolls"
  ADD CONSTRAINT "social_security_payrolls_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "social_security_payrolls_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_memberships" (
  "payrollId"      UUID NOT NULL,
  "collaboratorId" UUID NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_memberships_pkey" PRIMARY KEY ("payrollId","collaboratorId")
);
CREATE INDEX "payroll_memberships_collaboratorId_idx" ON "payroll_memberships"("collaboratorId");
ALTER TABLE "payroll_memberships"
  ADD CONSTRAINT "payroll_memberships_payrollId_fkey"
  FOREIGN KEY ("payrollId") REFERENCES "social_security_payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_memberships_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. Certificados de trabajo en alturas ──────────────────────────────
CREATE TABLE "height_certificates" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "collaboratorId" UUID NOT NULL,
  "issuedAt"       DATE NOT NULL,
  "expiresAt"      DATE NOT NULL,
  "trainingEntity" TEXT,
  "fileId"         UUID,
  "createdById"    UUID,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "height_certificates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "height_certificates_collaboratorId_expiresAt_idx" ON "height_certificates"("collaboratorId","expiresAt");
CREATE INDEX "height_certificates_expiresAt_idx" ON "height_certificates"("expiresAt");
ALTER TABLE "height_certificates"
  ADD CONSTRAINT "height_certificates_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "height_certificates_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "height_certificates_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 4. La jornada dentro del envío ─────────────────────────────────────
ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

ALTER TABLE "form_submissions"
  ADD COLUMN "workDate"   DATE,
  ADD COLUMN "startedAt"  TIMESTAMP(3),
  ADD COLUMN "closedAt"   TIMESTAMP(3),
  ADD COLUMN "closedById" UUID;

ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "form_submissions_status_workDate_idx" ON "form_submissions"("status","workDate");

-- Los envíos anteriores no registraban jornada: se toma el día del envío.
UPDATE "form_submissions"
   SET "workDate"  = ("submittedAt" AT TIME ZONE 'UTC')::date,
       "startedAt" = "submittedAt"
 WHERE "submittedAt" IS NOT NULL;

-- ── 5. Integrantes de la cuadrilla ─────────────────────────────────────
CREATE TABLE "submission_members" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "submissionId"   UUID NOT NULL,
  "collaboratorId" UUID NOT NULL,
  "jobPositionId"  UUID,
  "isLead"         BOOLEAN NOT NULL DEFAULT false,
  "complianceJson" JSONB NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "submission_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "submission_members_submissionId_collaboratorId_key"
  ON "submission_members"("submissionId","collaboratorId");
CREATE INDEX "submission_members_collaboratorId_idx" ON "submission_members"("collaboratorId");
ALTER TABLE "submission_members"
  ADD CONSTRAINT "submission_members_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "submission_members_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "submission_members_jobPositionId_fkey"
  FOREIGN KEY ("jobPositionId") REFERENCES "job_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cada envío histórico se vuelve una cuadrilla de una persona: la que lo firmó.
-- Su cumplimiento se rescata del snapshot de ARL que ya guardaba el envío.
INSERT INTO "submission_members" ("submissionId","collaboratorId","isLead","complianceJson","createdAt")
SELECT "id", "collaboratorId", true,
       jsonb_build_object('arl', COALESCE("arlSnapshotJson"::jsonb, '{}'::jsonb), 'migrated', true),
       "createdAt"
  FROM "form_submissions";

-- ── 6. Una firma por integrante ────────────────────────────────────────
ALTER TABLE "signatures" ADD COLUMN "memberId" UUID;

UPDATE "signatures" s
   SET "memberId" = m."id"
  FROM "submission_members" m
 WHERE m."submissionId" = s."submissionId";

DROP INDEX IF EXISTS "signatures_submissionId_key";
CREATE UNIQUE INDEX "signatures_memberId_key" ON "signatures"("memberId");
CREATE INDEX "signatures_submissionId_idx" ON "signatures"("submissionId");
ALTER TABLE "signatures"
  ADD CONSTRAINT "signatures_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "submission_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
