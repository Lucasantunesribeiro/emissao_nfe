import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { httpErrorInterceptor } from './core/interceptors/http-error.interceptor';
import { loadingInterceptor } from './core/interceptors/loading.interceptor';
// import { authInterceptor } from './core/interceptors/auth.interceptor';
// import { Amplify } from 'aws-amplify';
// import { environment } from '../environments/environment';

// TODO: Autenticação será implementada posteriormente
// export function initializeAmplify() {
//   return () => {
//     Amplify.configure({
//       Auth: {
//         Cognito: {
//           userPoolId: environment.cognitoUserPoolId,
//           userPoolClientId: environment.cognitoClientId,
//         }
//       }
//     });
//   };
// }

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([
        // authInterceptor,        // TODO: Habilitar quando implementar autenticação
        loadingInterceptor,     // PRIMEIRO: Loading spinner
        httpErrorInterceptor    // SEGUNDO: Tratamento de erros
      ])
    ),
    // TODO: Habilitar quando implementar autenticação
    // {
    //   provide: APP_INITIALIZER,
    //   useFactory: initializeAmplify,
    //   multi: true
    // }
  ]
};
