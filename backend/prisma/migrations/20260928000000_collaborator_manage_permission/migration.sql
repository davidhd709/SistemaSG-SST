INSERT INTO "permissions" ("id", "code", "description", "createdAt")
VALUES (gen_random_uuid(), 'collaborators:manage', 'Editar perfiles de colaboradores', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" IN ('ADMIN', 'ARL_MANAGER')
  AND permission."code" = 'collaborators:manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
