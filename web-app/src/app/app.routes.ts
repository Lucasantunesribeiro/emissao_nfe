import { Routes } from '@angular/router';
// import { authGuard, publicGuard } from './core/guards/auth.guard'; // TODO: Habilitar quando autenticação estiver implementada
import { ProdutosListaComponent } from './features/produtos/produtos-lista.component';
import { NotasListaComponent } from './features/notas/notas-lista.component';
import { NotaDetalhesComponent } from './features/notas/nota-detalhes.component';
import { LoginComponent } from './features/auth/login.component';
import { RegisterComponent } from './features/auth/register.component';

export const routes: Routes = [
  // Rotas públicas
  {
    path: 'login',
    component: LoginComponent
    // canActivate: [publicGuard] // TODO: Habilitar quando autenticação estiver implementada
  },
  {
    path: 'register',
    component: RegisterComponent
    // canActivate: [publicGuard] // TODO: Habilitar quando autenticação estiver implementada
  },

  // Rotas principais (sem proteção temporariamente)
  {
    path: 'produtos',
    component: ProdutosListaComponent
    // canActivate: [authGuard] // TODO: Habilitar quando autenticação estiver implementada
  },
  {
    path: 'notas',
    component: NotasListaComponent
    // canActivate: [authGuard] // TODO: Habilitar quando autenticação estiver implementada
  },
  {
    path: 'notas/:id',
    component: NotaDetalhesComponent
    // canActivate: [authGuard] // TODO: Habilitar quando autenticação estiver implementada
  },

  // Redirecionamentos
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];
