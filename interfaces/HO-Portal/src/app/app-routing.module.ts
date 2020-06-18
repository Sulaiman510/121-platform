import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './auth/auth.guard';
import { UserRole } from './auth/user-role.enum';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadChildren: './login/login.module#LoginPageModule',
  },
  {
    path: 'home',
    loadChildren: './home/home.module#HomePageModule',
    canActivate: [AuthGuard],
  },
  {
    path: 'help',
    loadChildren: './help/help.module#HelpPageModule',
    canActivate: [AuthGuard],
  },
  {
    path: 'program/:id',
    children: [
      {
        path: 'dashboard',
        loadChildren: './pages/dashboard/dashboard.module#DashboardPageModule',
        canActivate: [AuthGuard],
      },
      {
        path: 'aid-workers',
        loadChildren:
          './pages/aid-workers/aid-workers.module#AidWorkersPageModule',
        canActivate: [AuthGuard],
        data: {
          roles: [UserRole.ProgramManager],
        },
      },
      {
        path: 'design',
        loadChildren: './pages/design/design.module#DesignPageModule',
        canActivate: [AuthGuard],
      },
      {
        path: 'evaluation',
        loadChildren:
          './pages/evaluation/evaluation.module#EvaluationPageModule',
        canActivate: [AuthGuard],
      },
    ],
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}
