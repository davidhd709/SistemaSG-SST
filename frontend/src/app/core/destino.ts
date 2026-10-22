/** Perfil interno que devuelve `/api/users/me`. */
export type PerfilInterno = { roles: { code: string }[]; forcePasswordChange?: boolean };

/** Pantalla de trabajo de una cuenta interna según sus roles efectivos. */
export function destinoPorRoles(perfil: PerfilInterno): string {
  const roles = perfil.roles.map((role) => role.code);
  if (roles.includes('ADMIN')) return '/administracion/panel';
  if (roles.includes('COORDINATOR')) return '/coordinacion';
  if (roles.includes('ARL_MANAGER')) return '/gestor-arl';
  if (roles.includes('LEGAL')) return '/legal';
  return '/';
}
