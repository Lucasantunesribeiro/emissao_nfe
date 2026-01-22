import { HttpInterceptorFn, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError, tap } from 'rxjs';

/**
 * Interceptor global para tratamento de erros HTTP
 * Detecta respostas inválidas (HTML ao invés de JSON) e erros HTTP
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    tap((event) => {
      // Valida respostas bem-sucedidas para detectar HTML ao invés de JSON
      if (event instanceof HttpResponse) {
        const contentType = event.headers.get('content-type');
        const body = event.body;

        // Se esperamos JSON mas recebemos HTML/texto (CloudFront erro 404→200)
        if (contentType?.includes('text/html') && req.responseType !== 'text') {
          console.error('HTTP Error:', {
            url: req.url,
            status: event.status,
            message: 'API retornou HTML ao invés de JSON. Verifique a URL da API.',
            contentType: contentType
          });

          throw new HttpErrorResponse({
            error: 'Resposta inválida do servidor',
            headers: event.headers,
            status: event.status,
            statusText: 'Invalid Response',
            url: req.url || undefined
          });
        }

        // Detecta se body é string HTML quando esperávamos objeto
        if (typeof body === 'string' && body.trim().startsWith('<!DOCTYPE') && req.responseType !== 'text') {
          console.error('HTTP Error:', {
            url: req.url,
            status: event.status,
            message: 'API retornou HTML ao invés de JSON',
            bodyPreview: body.substring(0, 100)
          });

          throw new HttpErrorResponse({
            error: 'API retornou HTML ao invés de JSON',
            headers: event.headers,
            status: event.status,
            statusText: 'Invalid Response',
            url: req.url || undefined
          });
        }
      }
    }),
    catchError((error: HttpErrorResponse) => {
      let errorMessage = 'Erro desconhecido ao processar requisição';

      const serverMessage =
        typeof error.error === 'string'
          ? error.error
          : error.error?.erro || error.error?.mensagem || error.error?.message;

      if (error.error instanceof ErrorEvent) {
        // Erro client-side (rede, CORS, etc)
        errorMessage = `Erro de rede: ${error.error.message}`;
      } else {
        // Erro backend
        switch (error.status) {
          case 0:
            errorMessage = 'Servidor indisponível. Verifique sua conexão.';
            break;
          case 200:
            // Status 200 com erro = resposta inválida (HTML ao invés de JSON)
            if (error.statusText === 'Invalid Response') {
              errorMessage = serverMessage || 'API retornou HTML ao invés de JSON. Verifique a URL da API.';
            } else {
              errorMessage = serverMessage || 'Erro ao processar resposta do servidor';
            }
            break;
          case 400:
            errorMessage = serverMessage || 'Requisição inválida';
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
            errorMessage = serverMessage || 'Conflito ao processar requisição';
            break;
          case 422:
            errorMessage = serverMessage || 'Dados inválidos';
            break;
          case 500:
            errorMessage = 'Erro interno do servidor. Tente novamente.';
            break;
          case 503:
            errorMessage = 'Serviço temporariamente indisponível';
            break;
          default:
            errorMessage = serverMessage || `Erro ${error.status}: ${error.statusText}`;
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
