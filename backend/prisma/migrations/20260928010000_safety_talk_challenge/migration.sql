ALTER TABLE "form_submissions"
  ADD COLUMN "safetyTalkChallengeId" UUID,
  ADD COLUMN "safetyTalkVideo" TEXT,
  ADD COLUMN "safetyTalkVideoSha256" TEXT;

CREATE UNIQUE INDEX "form_submissions_safetyTalkChallengeId_key"
  ON "form_submissions"("safetyTalkChallengeId");
