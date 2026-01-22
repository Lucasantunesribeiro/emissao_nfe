import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, throwError, of } from 'rxjs';

export interface User {
  userId: string;
  email: string;
  username: string;
}

/**
 * AuthService STUB - Autenticação desabilitada temporariamente
 *
 * TODO: Implementar autenticação completa com AWS Cognito
 * quando a infraestrutura estiver pronta
 */
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router = inject(Router);
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor() {
    // Sistema sem autenticação - usuário sempre null
    this.currentUserSubject.next(null);
  }

  /**
   * Login - STUB (sempre retorna sucesso sem validação)
   */
  login(email: string, password: string): Observable<any> {
    console.warn('AuthService STUB: Login sem autenticação real');
    return of({ success: true });
  }

  /**
   * Logout - STUB
   */
  logout(): void {
    console.warn('AuthService STUB: Logout sem autenticação real');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  /**
   * Registrar novo usuário - STUB
   */
  register(email: string, password: string, nome: string, sobrenome?: string): Observable<void> {
    console.warn('AuthService STUB: Register sem autenticação real');
    return of(void 0);
  }

  /**
   * Confirmar registro com código - STUB
   */
  confirmRegistration(email: string, code: string): Observable<void> {
    console.warn('AuthService STUB: Confirm registration sem autenticação real');
    return of(void 0);
  }

  /**
   * Recuperar senha - STUB
   */
  forgotPassword(email: string): Observable<void> {
    console.warn('AuthService STUB: Forgot password sem autenticação real');
    return of(void 0);
  }

  /**
   * Confirmar nova senha - STUB
   */
  resetPasswordConfirm(email: string, code: string, newPassword: string): Observable<void> {
    console.warn('AuthService STUB: Reset password sem autenticação real');
    return of(void 0);
  }

  /**
   * Obter usuário atual - STUB (sempre retorna null)
   */
  getCurrentUserData(): Observable<User | null> {
    return this.currentUser$;
  }

  /**
   * Verificar se está autenticado - STUB (sempre retorna false)
   */
  isAuthenticated(): boolean {
    return false; // Sistema sem autenticação
  }

  /**
   * Obter ID token - STUB (sempre retorna null)
   */
  getIdToken(): string | null {
    return null;
  }

  /**
   * Obter ID token async - STUB
   */
  getIdTokenAsync(): Observable<string> {
    console.warn('AuthService STUB: Token não disponível (sem autenticação)');
    return throwError(() => new Error('Autenticação não configurada'));
  }

  /**
   * Refresh token - STUB
   */
  refreshToken(): Observable<string> {
    return this.getIdTokenAsync();
  }
}
