import { Routes } from '@angular/router';
import { HomeComponent } from './features/home/home.component';
import { AdminLoginComponent } from './features/auth/admin-login.component';
import { CollaboratorLoginComponent } from './features/auth/collaborator-login.component';
import { sesionRequerida } from './core/auth.guard';

const interna = [sesionRequerida('ADMIN')];

// Las pantallas de entrada se cargan de inmediato; el resto, al visitarlas,
// para que el celular en obra descargue solo lo que va a usar.
export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'Sistema SG-SST' },
  { path: 'ingreso', component: CollaboratorLoginComponent, title: 'Ingreso colaborador' },
  { path: 'administracion', component: AdminLoginComponent, pathMatch: 'full', title: 'Acceso administrativo' },

  {
    path: 'formatos',
    loadComponent: () => import('./features/forms/form-picker.component').then((m) => m.FormPickerComponent),
    canActivate: [sesionRequerida('COLLABORATOR')],
    title: 'Formatos',
  },
  {
    // alturas, ats, electrico o escalera: el mismo flujo, guiado por el perfil del formato.
    path: 'formulario/:formato',
    loadComponent: () =>
      import('./features/forms/work-at-height-form.component').then((m) => m.WorkAtHeightFormComponent),
    canActivate: [sesionRequerida('COLLABORATOR')],
    title: 'Formato SG-SST',
  },
  {
    path: 'mis-permisos',
    loadComponent: () => import('./features/forms/my-permits.component').then((m) => m.MyPermitsComponent),
    canActivate: [sesionRequerida('COLLABORATOR')],
    title: 'Mis permisos',
  },

  {
    path: 'administracion/panel',
    loadComponent: () => import('./features/admin/admin-dashboard.component').then((m) => m.AdminDashboardComponent),
    canActivate: interna,
    title: 'Administración SG-SST',
  },
  {
    path: 'coordinacion',
    loadComponent: () => import('./features/coordination/coordination.component').then((m) => m.CoordinationComponent),
    canActivate: interna,
    title: 'Coordinación',
  },
  {
    path: 'administracion/mi-firma',
    loadComponent: () => import('./features/auth/my-signature.component').then((m) => m.MySignatureComponent),
    canActivate: interna,
    title: 'Mi firma',
  },
  {
    path: 'administracion/mi-contrasena',
    loadComponent: () => import('./features/auth/change-password.component').then((m) => m.ChangePasswordComponent),
    canActivate: interna,
    title: 'Cambiar contraseña',
  },
  {
    path: 'arl',
    loadComponent: () => import('./features/arl/arl-list.component').then((m) => m.ArlListComponent),
    canActivate: interna,
    title: 'Estado ARL',
  },
  {
    path: 'gestor-arl',
    loadComponent: () => import('./features/arl/arl-list.component').then((m) => m.ArlListComponent),
    canActivate: interna,
    title: 'Gestor ARL',
  },
  {
    path: 'seguridad-social',
    loadComponent: () =>
      import('./features/compliance/social-security.component').then((m) => m.SocialSecurityComponent),
    canActivate: interna,
    title: 'Seguridad social',
  },
  {
    path: 'legal',
    loadComponent: () => import('./features/legal/legal-search.component').then((m) => m.LegalSearchComponent),
    canActivate: interna,
    title: 'Consulta Legal',
  },

  { path: '**', redirectTo: '' },
];
