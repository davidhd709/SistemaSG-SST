-- El colaborador también necesita renovar su sesión: sin esto, recargar la
-- página lo expulsa a mitad del diligenciamiento.
ALTER TABLE "refresh_sessions" ADD COLUMN "collaboratorId" UUID;

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "collaborators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "refresh_sessions_collaboratorId_expiresAt_idx"
  ON "refresh_sessions"("collaboratorId", "expiresAt");
