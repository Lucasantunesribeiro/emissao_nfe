import { Routes } from '@angular/router';
import { authGuard, publicGuard } from './core/guards/auth.guard';
import { LoginComponent } from './features/auth/login.component';
import { RegisterComponent } from './features/auth/register.component';
import { NotaDetalhesComponent } from './features/notas/nota-detalhes.component';
import { NotasListaComponent } from './features/notas/notas-lista.component';
import { ProdutosListaComponent } from './features/produtos/produtos-lista.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [publicGuard],
  },
  {
    path: 'register',
    component: RegisterComponent,
    canActivate: [publicGuard],
  },
  {
    path: 'produtos',
    component: ProdutosListaComponent,
    canActivate: [authGuard],
  },
  {
    path: 'notas',
    component: NotasListaComponent,
    canActivate: [authGuard],
  },
  {
    path: 'notas/:id',
    component: NotaDetalhesComponent,
    canActivate: [authGuard],
  },
  { path: '', redirectTo: '/produtos', pathMatch: 'full' },
  { path: '**', redirectTo: '/produtos' },
];
