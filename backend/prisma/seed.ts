import * as argon2 from 'argon2';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { workAtHeightSchema } from './seed-data/work-at-height';
import { safeWorkAnalysisSchema } from './seed-data/safe-work-analysis';
import { electricalPermitSchema } from './seed-data/electrical-permit';
import { ladderInspectionSchema } from './seed-data/ladder-inspection';

const envPath = resolve(__dirname, '../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const prisma = new PrismaClient();

const roles: Record<string, { name: string; permissions: string[] }> = {
  ADMIN: {
    name: 'Administrador',
    permissions: [
      'users:create',
      'users:read',
      'users:manage',
      'roles:read',
      'collaborators:create',
      'collaborators:read',
      'collaborators:manage',
      'job-positions:manage',
      'arl:read',
      'arl:manage',
      'forms:manage',
      'submissions:review',
      'submissions:close-admin',
      'files:read',
      'legal:read',
      'compliance:read',
      'compliance:manage',
      'settings:manage',
      'audit:read',
      'reports:read',
    ],
  },
  COORDINATOR: {
    name: 'Coordinador operativo',
    permissions: [
      'submissions:review',
      'submissions:close-admin',
      'files:read',
      'signatures:manage',
      'collaborators:read',
      'arl:read',
      'compliance:read',
      'compliance:manage',
      'reports:read',
    ],
  },
  LEGAL: {
    name: 'Legal',
    permissions: ['collaborators:read', 'arl:read', 'files:read', 'legal:read', 'compliance:read', 'reports:read'],
  },
  ARL_MANAGER: {
    name: 'Gestor de ARL',
    permissions: ['collaborators:create', 'collaborators:read', 'collaborators:manage', 'arl:read', 'arl:manage'],
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
  // Cargos iniciales de la cuadrilla. Solo el oficial eléctrico abre permisos
  // de trabajo y requiere certificado de alturas. Después del primer seed el
  // catálogo se administra desde la aplicación, así que aquí solo se crean.
  const cargos = [
    { code: 'OFICIAL_ELECTRICO', name: 'Oficial eléctrico', canLead: true, requiresHeightCertificate: true },
    { code: 'AUXILIAR_ELECTRICO', name: 'Auxiliar eléctrico', canLead: false, requiresHeightCertificate: false },
    { code: 'AYUDANTE', name: 'Ayudante', canLead: false, requiresHeightCertificate: false },
    { code: 'SUPERVISOR', name: 'Supervisor', canLead: false, requiresHeightCertificate: false },
  ];
  for (const cargo of cargos) {
    await prisma.jobPosition.upsert({ where: { code: cargo.code }, update: {}, create: cargo });
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
  // Una versión publicada es inmutable. Reejecutar el seed no debe reescribir
  // su esquema ni volver a publicar v4 si ya existe una versión posterior.
  const version = await prisma.formVersion.upsert({
    where: { formId_versionNumber: { formId: form.id, versionNumber: 4 } },
    update: {},
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
  if (!form.currentVersionId) {
    await prisma.formVersion.updateMany({
      where: { formId: form.id, versionNumber: { not: 4 } },
      data: { active: false },
    });
    await prisma.form.update({ where: { id: form.id }, data: { status: 'PUBLISHED', currentVersionId: version.id } });
  }
  for (const formato of formatosOficiales) await publicarFormato(formato);

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

/** Formatos oficiales que se diligencian sueltos, cada uno con su plantilla PDF intacta. */
const formatosOficiales = [
  {
    code: 'HSE-FO-018',
    name: 'Análisis de trabajo seguro (ATS)',
    description: 'Formato HSE-FO-018, versión 02 del 15/08/2025.',
    schema: safeWorkAnalysisSchema,
  },
  {
    code: 'FORSG-03',
    name: 'Permiso de trabajo - riesgo eléctrico',
    description: 'Formato FORSG-03, versión 002 de enero de 2020.',
    schema: electricalPermitSchema,
  },
  {
    code: 'HSE-FO-023',
    name: 'Inspección de escaleras',
    description: 'Formato HSE-FO-023, versión 00 del 29/06/2022.',
    schema: ladderInspectionSchema,
  },
];

/**
 * Crea el formato con su versión digital 1 publicada. Si ya existe no lo
 * toca: una versión publicada es inmutable y sus cambios se hacen desde
 * Administración → Formatos.
 */
async function publicarFormato(formato: (typeof formatosOficiales)[number]) {
  const form = await prisma.form.upsert({
    where: { code: formato.code },
    update: {},
    create: { code: formato.code, name: formato.name, description: formato.description },
  });
  const version = await prisma.formVersion.upsert({
    where: { formId_versionNumber: { formId: form.id, versionNumber: 1 } },
    update: {},
    create: {
      formId: form.id,
      versionNumber: 1,
      schemaJson: formato.schema,
      changeReason: `Versión digital del formato oficial ${formato.code}.`,
      active: true,
      publishedAt: new Date(),
    },
  });
  if (!form.currentVersionId) {
    await prisma.form.update({ where: { id: form.id }, data: { status: 'PUBLISHED', currentVersionId: version.id } });
  }
}

main().finally(async () => prisma.$disconnect());
