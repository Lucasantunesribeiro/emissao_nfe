import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { RuntimeConfigService } from './core/config/runtime-config.service';
import { AuthService } from './core/services/auth.service';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { correlationIdInterceptor } from './core/interceptors/correlation-id.interceptor';
import { httpErrorInterceptor } from './core/interceptors/http-error.interceptor';
import { loadingInterceptor } from './core/interceptors/loading.interceptor';

function initializeApplication(runtimeConfig: RuntimeConfigService, authService: AuthService) {
  return async () => {
    await runtimeConfig.load();
    await authService.initialize();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([
        correlationIdInterceptor,
        authInterceptor,
        loadingInterceptor,
        httpErrorInterceptor,
      ])
    ),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApplication,
      deps: [RuntimeConfigService, AuthService],
      multi: true,
    },
  ],
};
