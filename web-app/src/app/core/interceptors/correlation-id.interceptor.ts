import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { RuntimeConfigService } from '../config/runtime-config.service';

const CORRELATION_ID_HEADER = 'X-Correlation-Id';

export const correlationIdInterceptor: HttpInterceptorFn = (req, next) => {
  const runtimeConfig = inject(RuntimeConfigService).value;
  const apiBases = [runtimeConfig.api.estoqueUrl, runtimeConfig.api.faturamentoUrl].filter(Boolean);
  const isApiRequest = apiBases.some((baseUrl) => req.url.startsWith(baseUrl));

  if (!runtimeConfig.observability.enableCorrelationId || !isApiRequest) {
    return next(req);
  }

  const correlationId =
    req.headers.get(CORRELATION_ID_HEADER) ??
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return next(req.clone({
    setHeaders: {
      [CORRELATION_ID_HEADER]: correlationId,
    },
  }));
};
