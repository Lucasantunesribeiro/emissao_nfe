import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, catchError, from, map, of, switchMap, tap, throwError } from 'rxjs';
import { Amplify } from 'aws-amplify';
import {
  confirmResetPassword,
  confirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  resendSignUpCode,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { defaultStorage } from 'aws-amplify/utils';
import { RuntimeConfigService } from '../config/runtime-config.service';

export interface User {
  userId: string;
  email: string;
  username: string;
}

export interface RegistrationResult {
  requiresConfirmation: boolean;
  destination?: string;
  username: string;
}

export interface PasswordResetResult {
  destination?: string;
  deliveryMedium?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly router = inject(Router);
  private readonly runtimeConfig = inject(RuntimeConfigService);
  private readonly currentUserSubject = new BehaviorSubject<User | null>(null);
  private currentIdToken: string | null = null;
  private amplifyConfigured = false;

  readonly currentUser$ = this.currentUserSubject.asObservable();

  async initialize(): Promise<void> {
    if (!this.isEnabled()) {
      this.currentUserSubject.next(null);
      this.currentIdToken = null;
      return;
    }

    if (!this.amplifyConfigured) {
      const { auth } = this.runtimeConfig.value;

      Amplify.configure({
        Auth: {
          Cognito: {
            userPoolId: auth.userPoolId,
            userPoolClientId: auth.userPoolClientId,
            loginWith: {
              email: true,
            },
            signUpVerificationMethod: 'code',
          },
        },
      });

      cognitoUserPoolsTokenProvider.setKeyValueStorage(defaultStorage);
      this.amplifyConfigured = true;
    }

    try {
      await this.refreshCurrentUser();
    } catch {
      this.currentUserSubject.next(null);
      this.currentIdToken = null;
    }
  }

  login(email: string, password: string): Observable<User> {
    if (!this.isEnabled()) {
      return throwError(() => new Error('Autenticação Cognito não está habilitada neste ambiente.'));
    }

    return from(signIn({
      username: email.trim().toLowerCase(),
      password,
    })).pipe(
      switchMap((result) => {
        if (!result.isSignedIn) {
          const nextStep = result.nextStep?.signInStep;
          return throwError(() => new Error(this.mapSignInStep(nextStep)));
        }

        return from(this.refreshCurrentUser());
      })
    );
  }

  logout(): Observable<void> {
    const cleanup = () => {
      this.currentIdToken = null;
      this.currentUserSubject.next(null);
      void this.router.navigate(['/login']);
    };

    if (!this.isEnabled()) {
      cleanup();
      return of(void 0);
    }

    return from(signOut()).pipe(
      tap(() => cleanup()),
      map(() => void 0),
      catchError((error) => {
        cleanup();
        return throwError(() => this.normalizeError(error));
      })
    );
  }

  register(email: string, password: string, nome: string, sobrenome?: string): Observable<RegistrationResult> {
    if (!this.isEnabled()) {
      return throwError(() => new Error('Autenticação Cognito não está habilitada neste ambiente.'));
    }

    const { givenName, familyName } = this.splitName(nome, sobrenome);
    const normalizedEmail = email.trim().toLowerCase();

    return from(signUp({
      username: normalizedEmail,
      password,
      options: {
        userAttributes: {
          email: normalizedEmail,
          given_name: givenName,
          family_name: familyName,
        },
      },
    })).pipe(
      map((result) => {
        const deliveryDetails = 'codeDeliveryDetails' in result.nextStep
          ? result.nextStep.codeDeliveryDetails
          : undefined;

        return {
          requiresConfirmation: result.nextStep.signUpStep !== 'DONE',
          destination: deliveryDetails?.destination,
          username: normalizedEmail,
        };
      }),
      catchError((error) => throwError(() => this.normalizeError(error)))
    );
  }

  confirmRegistration(email: string, code: string): Observable<void> {
    return from(confirmSignUp({
      username: email.trim().toLowerCase(),
      confirmationCode: code.trim(),
    })).pipe(
      map(() => void 0),
      catchError((error) => throwError(() => this.normalizeError(error)))
    );
  }

  resendConfirmationCode(email: string): Observable<void> {
    return from(resendSignUpCode({
      username: email.trim().toLowerCase(),
    })).pipe(
      map(() => void 0),
      catchError((error) => throwError(() => this.normalizeError(error)))
    );
  }

  forgotPassword(email: string): Observable<PasswordResetResult> {
    return from(resetPassword({
      username: email.trim().toLowerCase(),
    })).pipe(
      map((result) => {
        const deliveryDetails = 'codeDeliveryDetails' in result.nextStep
          ? result.nextStep.codeDeliveryDetails
          : undefined;

        return {
          destination: deliveryDetails?.destination,
          deliveryMedium: deliveryDetails?.deliveryMedium,
        };
      }),
      catchError((error) => throwError(() => this.normalizeError(error)))
    );
  }

  resetPasswordConfirm(email: string, code: string, newPassword: string): Observable<void> {
    return from(confirmResetPassword({
      username: email.trim().toLowerCase(),
      confirmationCode: code.trim(),
      newPassword,
    })).pipe(
      map(() => void 0),
      catchError((error) => throwError(() => this.normalizeError(error)))
    );
  }

  getCurrentUserData(): Observable<User | null> {
    return this.currentUser$;
  }

  isEnabled(): boolean {
    const { auth } = this.runtimeConfig.value;
    return auth.enabled && !!auth.userPoolId && !!auth.userPoolClientId;
  }

  isAuthenticated(): boolean {
    return this.currentUserSubject.value !== null;
  }

  getIdToken(): string | null {
    return this.currentIdToken;
  }

  getIdTokenAsync(): Observable<string> {
    return from(this.fetchIdToken());
  }

  refreshToken(): Observable<string> {
    return from(this.fetchIdToken(true));
  }

  private async refreshCurrentUser(): Promise<User> {
    const [session, currentUser] = await Promise.all([
      fetchAuthSession(),
      getCurrentUser(),
    ]);

    const idToken = session.tokens?.idToken?.toString();
    if (!idToken) {
      throw new Error('Token JWT não encontrado para a sessão atual.');
    }

    const payload = session.tokens?.idToken?.payload;
    const email = typeof payload?.['email'] === 'string'
      ? payload['email']
      : currentUser.signInDetails?.loginId ?? currentUser.username;
    const user: User = {
      userId: currentUser.userId,
      email,
      username: currentUser.username,
    };

    this.currentIdToken = idToken;
    this.currentUserSubject.next(user);
    return user;
  }

  private async fetchIdToken(forceRefresh = false): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Autenticação Cognito não está habilitada neste ambiente.');
    }

    const session = await fetchAuthSession({ forceRefresh });
    const idToken = session.tokens?.idToken?.toString();
    if (!idToken) {
      throw new Error('Sessão inválida ou expirada.');
    }

    this.currentIdToken = idToken;
    return idToken;
  }

  private splitName(nomeCompleto: string, sobrenome?: string): { givenName: string; familyName: string } {
    if (sobrenome?.trim()) {
      return {
        givenName: nomeCompleto.trim(),
        familyName: sobrenome.trim(),
      };
    }

    const parts = nomeCompleto.trim().split(/\s+/);
    return {
      givenName: parts[0] ?? nomeCompleto.trim(),
      familyName: parts.slice(1).join(' ') || parts[0] || 'Usuario',
    };
  }

  private mapSignInStep(step: string | undefined): string {
    switch (step) {
      case 'CONFIRM_SIGN_UP':
        return 'Conta criada, mas ainda não confirmada. Informe o código enviado por email.';
      case 'DONE':
        return 'Login concluído.';
      default:
        return 'Existe um desafio adicional de autenticação pendente para este usuário.';
    }
  }

  private normalizeError(error: unknown): Error {
    const raw = error as { name?: string; message?: string };

    switch (raw?.name) {
      case 'UserNotConfirmedException':
        return new Error('Usuário ainda não confirmou o email.');
      case 'NotAuthorizedException':
        return new Error('Credenciais inválidas.');
      case 'UserAlreadyAuthenticatedException':
        return new Error('Usuário já autenticado.');
      case 'UsernameExistsException':
        return new Error('Já existe uma conta cadastrada com este email.');
      case 'CodeMismatchException':
        return new Error('Código informado é inválido.');
      case 'ExpiredCodeException':
        return new Error('O código expirou. Solicite um novo código.');
      case 'LimitExceededException':
        return new Error('Limite de tentativas excedido. Tente novamente em instantes.');
      default:
        return new Error(raw?.message ?? 'Falha ao processar autenticação.');
    }
  }
}
