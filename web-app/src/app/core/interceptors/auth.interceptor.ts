import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const runtimeConfig = inject(RuntimeConfigService).value;
  const apiBases = [runtimeConfig.api.estoqueUrl, runtimeConfig.api.faturamentoUrl].filter(Boolean);
  const isApiRequest = apiBases.some((baseUrl) => req.url.startsWith(baseUrl));

  if (!authService.isEnabled() || !isApiRequest) {
    return next(req);
  }

  return authService.getIdTokenAsync().pipe(
    switchMap((token) => next(req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    })).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status !== 401) {
          return throwError(() => error);
        }

        return authService.refreshToken().pipe(
          switchMap((newToken) => next(req.clone({
            setHeaders: {
              Authorization: `Bearer ${newToken}`,
            },
          }))),
          catchError((refreshError) => {
            authService.logout().subscribe({
              error: () => undefined,
            });
            void router.navigate(['/login'], {
              queryParams: { returnUrl: router.url, expired: 'true' },
            });
            return throwError(() => refreshError);
          })
        );
      })
    )),
    catchError((error) => {
      void router.navigate(['/login'], {
        queryParams: { returnUrl: router.url },
      });
      return throwError(() => error);
    })
  );
};
