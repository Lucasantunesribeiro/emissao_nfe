import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isEnabled()) {
    return true;
  }

  return authService.currentUser$.pipe(
    take(1),
    map((user) => {
      if (user) {
        return true;
      }

      void router.navigate(['/login'], {
        queryParams: { returnUrl: state.url },
      });
      return false;
    })
  );
};

export const publicGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isEnabled()) {
    return true;
  }

  return authService.currentUser$.pipe(
    take(1),
    map((user) => {
      if (user) {
        void router.navigate(['/produtos']);
        return false;
      }

      return true;
    })
  );
};
