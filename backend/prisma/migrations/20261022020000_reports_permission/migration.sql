-- Exportar reportes en Excel incluye datos personales de la plantilla: se
-- concede solo a los roles que ya consultan permisos y cumplimiento.
INSERT INTO "permissions" ("id", "code", "description", "createdAt")
VALUES (gen_random_uuid(), 'reports:read', 'Exportar reportes de permisos y cumplimiento', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."code" IN ('ADMIN', 'COORDINATOR', 'LEGAL')
  AND permission."code" = 'reports:read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
