import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

/**
 * Guard de autenticação
 *
 * Protege rotas que requerem autenticação.
 * Redireciona para /login se usuário não estiver autenticado.
 */
export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map((user) => {
      if (user) {
        // Usuário autenticado: permitir acesso
        return true;
      }

      // Usuário não autenticado: redirecionar para login
      console.log('AuthGuard: Usuário não autenticado, redirecionando para /login');
      router.navigate(['/login'], {
        queryParams: { returnUrl: state.url },
      });
      return false;
    })
  );
};

/**
 * Guard inverso para páginas públicas (login, register)
 *
 * Redireciona para home se usuário já estiver autenticado.
 */
export const publicGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map((user) => {
      if (user) {
        // Já autenticado: redirecionar para home
        router.navigate(['/produtos']);
        return false;
      }

      // Não autenticado: permitir acesso à página pública
      return true;
    })
  );
};
