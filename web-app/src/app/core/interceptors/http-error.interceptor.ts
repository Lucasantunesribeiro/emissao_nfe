import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

/**
 * Interceptor global para tratamento de erros HTTP
 * Exibe alertas para erros comuns (500, 401, 403, timeout)
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let errorMessage = 'Erro desconhecido ao processar requisição';

      if (error.error instanceof ErrorEvent) {
        // Erro client-side (rede, CORS, etc)
        errorMessage = `Erro de rede: ${error.error.message}`;
      } else {
        // Erro backend
        switch (error.status) {
          case 0:
            errorMessage = 'Servidor indisponível. Verifique sua conexão.';
            break;
          case 400:
            errorMessage = error.error?.message || 'Requisição inválida';
            break;
          case 401:
            errorMessage = 'Sessão expirada. Faça login novamente.';
            break;
          case 403:
            errorMessage = 'Acesso negado a este recurso';
            break;
          case 404:
            errorMessage = 'Recurso não encontrado';
            break;
          case 409:
            errorMessage = error.error?.message || 'Conflito ao processar requisição';
            break;
          case 422:
            errorMessage = error.error?.message || 'Dados inválidos';
            break;
          case 500:
            errorMessage = 'Erro interno do servidor. Tente novamente.';
            break;
          case 503:
            errorMessage = 'Serviço temporariamente indisponível';
            break;
          default:
            errorMessage = `Erro ${error.status}: ${error.error?.message || error.statusText}`;
        }
      }

      // Log para debugging (apenas em dev)
      console.error('HTTP Error:', {
        url: req.url,
        status: error.status,
        message: errorMessage,
        details: error.error
      });

      // Em produção, enviar para serviço de monitoramento (Sentry, CloudWatch, etc)
      // if (environment.production) {
      //   sendToMonitoring(error);
      // }

      // Propaga o erro com mensagem tratada
      return throwError(() => new Error(errorMessage));
    })
  );
};
