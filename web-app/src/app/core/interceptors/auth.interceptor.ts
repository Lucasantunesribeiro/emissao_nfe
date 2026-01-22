import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Interceptor de autenticação JWT
 *
 * - Injeta token ID do Cognito em todas as requisições para a API
 * - Renova token automaticamente em caso de expiração (401)
 * - Redireciona para login se refresh falhar
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Verificar se a requisição é para a API
  const isApiRequest = req.url.includes('execute-api') || req.url.includes('/api/');

  if (!isApiRequest) {
    // Não interceptar requisições que não são para a API
    return next(req);
  }

  // Clonar requisição e adicionar token
  return authService.getIdTokenAsync().pipe(
    switchMap((token) => {
      const authReq = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`,
        },
      });

      return next(authReq).pipe(
        catchError((error: HttpErrorResponse) => {
          if (error.status === 401) {
            // Token expirado: tentar renovar
            console.log('Token expirado (401), tentando renovar...');

            return authService.refreshToken().pipe(
              switchMap((newToken) => {
                // Retentar requisição com novo token
                const retryReq = req.clone({
                  setHeaders: {
                    Authorization: `Bearer ${newToken}`,
                  },
                });
                return next(retryReq);
              }),
              catchError((refreshError) => {
                // Refresh falhou: fazer logout
                console.error('Falha ao renovar token:', refreshError);
                authService.logout().subscribe();
                router.navigate(['/login'], {
                  queryParams: { returnUrl: router.url, expired: 'true' },
                });
                return throwError(() => error);
              })
            );
          }

          // Outros erros: propagar
          return throwError(() => error);
        })
      );
    }),
    catchError((error) => {
      // Erro ao obter token inicial: redirecionar para login
      console.error('Erro ao obter token:', error);
      if (isApiRequest) {
        router.navigate(['/login'], {
          queryParams: { returnUrl: router.url },
        });
      }
      return throwError(() => error);
    })
  );
};
