import * as argon2 from 'argon2';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { workAtHeightSchema } from './seed-data/work-at-height';

process.loadEnvFile(resolve(__dirname, '../../.env'));

const prisma = new PrismaClient();

const roles: Record<string, { name: string; permissions: string[] }> = {
  ADMIN: {
    name: 'Administrador',
    permissions: [
      'users:create',
      'users:read',
      'roles:read',
      'collaborators:create',
      'collaborators:read',
      'arl:read',
      'arl:manage',
      'forms:manage',
      'submissions:review',
      'files:read',
      'legal:read',
      'compliance:read',
      'compliance:manage',
      'settings:manage',
      'audit:read',
    ],
  },
  COORDINATOR: {
    name: 'Coordinador operativo',
    permissions: [
      'submissions:review',
      'files:read',
      'signatures:manage',
      'collaborators:read',
      'arl:read',
      'compliance:read',
      'compliance:manage',
    ],
  },
  LEGAL: {
    name: 'Legal',
    permissions: ['collaborators:read', 'arl:read', 'files:read', 'legal:read', 'compliance:read'],
  },
  ARL_MANAGER: {
    name: 'Gestor de ARL',
    permissions: ['collaborators:create', 'collaborators:read', 'arl:read', 'arl:manage'],
  },
};

async function main(): Promise<void> {
  for (const [code, definition] of Object.entries(roles)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: definition.name },
      create: { code, name: definition.name },
    });
    for (const permissionCode of definition.permissions) {
      const permission = await prisma.permission.upsert({
        where: { code: permissionCode },
        update: {},
        create: { code: permissionCode },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
    // El catálogo de cada rol es declarativo: al cambiarlo, los permisos que
    // ya no pertenecen al rol deben retirarse también.
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permission: { code: { notIn: definition.permissions } } },
    });
  }
  // Cargos de la cuadrilla. Solo el oficial eléctrico abre permisos de trabajo.
  const cargos = [
    { code: 'OFICIAL_ELECTRICO', name: 'Oficial eléctrico', canLead: true },
    { code: 'AUXILIAR_ELECTRICO', name: 'Auxiliar eléctrico', canLead: false },
    { code: 'AYUDANTE', name: 'Ayudante', canLead: false },
    { code: 'SUPERVISOR', name: 'Supervisor', canLead: false },
  ];
  for (const cargo of cargos) {
    await prisma.jobPosition.upsert({
      where: { code: cargo.code },
      update: { name: cargo.name, canLead: cargo.canLead },
      create: cargo,
    });
  }

  await prisma.systemSetting.upsert({
    where: { key: 'arl_expiring_days' },
    update: { valueJson: 5 },
    create: { key: 'arl_expiring_days', valueJson: 5 },
  });
  const form = await prisma.form.upsert({
    where: { code: 'HSE-FO-016' },
    update: { name: 'Permiso de trabajo en altura', description: 'Formato basado en HSE-FO-016, versión 00.' },
    create: {
      code: 'HSE-FO-016',
      name: 'Permiso de trabajo en altura',
      description: 'Formato basado en HSE-FO-016, versión 00.',
    },
  });
  // La versión 2 automatiza fecha, horas y verificación de requisitos, y saca
  // el cargo del formulario porque ahora se define por integrante de cuadrilla.
  // La 1 se conserva: los permisos firmados con ella deben poder leerse igual.
  const version = await prisma.formVersion.upsert({
    where: { formId_versionNumber: { formId: form.id, versionNumber: 4 } },
    update: { schemaJson: workAtHeightSchema },
    create: {
      formId: form.id,
      versionNumber: 4,
      schemaJson: workAtHeightSchema,
      changeReason:
        'Permiso de cuadrilla: fecha y horas automáticas, requisitos verificados por el sistema y cargo por integrante.',
      active: true,
      publishedAt: new Date(),
    },
  });
  await prisma.formVersion.updateMany({
    where: { formId: form.id, versionNumber: { not: 4 } },
    data: { active: false },
  });
  await prisma.form.update({ where: { id: form.id }, data: { status: 'PUBLISHED', currentVersionId: version.id } });
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error('Defina BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD para crear el administrador inicial.');
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
  });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });
}

main().finally(async () => prisma.$disconnect());
