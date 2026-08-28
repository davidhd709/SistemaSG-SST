CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');
CREATE TABLE "approvals" ("id" UUID NOT NULL, "submissionId" UUID NOT NULL, "decision" "ApprovalDecision" NOT NULL, "decidedById" UUID NOT NULL, "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reason" TEXT, CONSTRAINT "approvals_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "approvals_submissionId_key" ON "approvals"("submissionId");
CREATE INDEX "approvals_decidedById_decidedAt_idx" ON "approvals"("decidedById", "decidedAt");
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "form_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
