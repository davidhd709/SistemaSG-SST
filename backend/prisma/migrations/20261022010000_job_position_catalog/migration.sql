-- El requisito de certificado de alturas pasa a ser una propiedad del cargo:
-- así el catálogo puede editarse sin depender del texto "Oficial eléctrico".
ALTER TABLE "job_positions" ADD COLUMN "requiresHeightCertificate" BOOLEAN NOT NULL DEFAULT false;

UPDATE "job_positions" SET "requiresHeightCertificate" = true WHERE "code" = 'OFICIAL_ELECTRICO';

INSERT INTO "permissions" ("id", "code", "description", "createdAt")
VALUES (gen_random_uuid(), 'job-positions:manage', 'Administrar el catálogo de cargos', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" = 'ADMIN'
  AND permission."code" = 'job-positions:manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
