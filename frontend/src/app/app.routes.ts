import { Routes } from '@angular/router';
import { HomeComponent } from './features/home/home.component';
import { AdminLoginComponent } from './features/auth/admin-login.component';
import { AdminDashboardComponent } from './features/admin/admin-dashboard.component';
import { CollaboratorLoginComponent } from './features/auth/collaborator-login.component';
import { ArlListComponent } from './features/arl/arl-list.component';
import { WorkAtHeightFormComponent } from './features/forms/work-at-height-form.component';
import { CoordinationComponent } from './features/coordination/coordination.component';
import { LegalSearchComponent } from './features/legal/legal-search.component';
import { sesionRequerida } from './core/auth.guard';

const interna = [sesionRequerida('ADMIN')];

export const routes: Routes = [
  { path: '', component: HomeComponent, title: 'Sistema SG-SST' },
  { path: 'ingreso', component: CollaboratorLoginComponent, title: 'Ingreso colaborador' },
  { path: 'administracion', component: AdminLoginComponent, pathMatch: 'full', title: 'Acceso administrativo' },

  {
    path: 'formulario/alturas',
    component: WorkAtHeightFormComponent,
    canActivate: [sesionRequerida('COLLABORATOR')],
    title: 'Permiso de trabajo en altura',
  },

  {
    path: 'administracion/panel',
    component: AdminDashboardComponent,
    canActivate: interna,
    title: 'Administración SG-SST',
  },
  { path: 'coordinacion', component: CoordinationComponent, canActivate: interna, title: 'Coordinación' },
  { path: 'arl', component: ArlListComponent, canActivate: interna, title: 'Estado ARL' },
  { path: 'gestor-arl', component: ArlListComponent, canActivate: interna, title: 'Gestor ARL' },
  { path: 'legal', component: LegalSearchComponent, canActivate: interna, title: 'Consulta Legal' },

  { path: '**', redirectTo: '' },
];
