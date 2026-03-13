import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

type AuthScreenMode = 'login' | 'forgotPassword' | 'resetPassword';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div class="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl shadow-2xl">
        <div class="text-center">
          <div class="mx-auto h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center mb-4">
            <svg class="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <h2 class="text-3xl font-bold text-gray-900">Sistema NFe</h2>
          <p class="mt-2 text-sm text-gray-600">
            {{ mode === 'login' ? 'Entre com sua conta para continuar' : mode === 'forgotPassword' ? 'Solicite o código de redefinição' : 'Informe o código recebido por email' }}
          </p>
        </div>

        <div *ngIf="!authEnabled" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          O Cognito não está configurado neste ambiente. Use o runtime config ou o deploy automatizado para habilitar autenticação.
        </div>

        <div *ngIf="successMessage" class="bg-green-50 border-l-4 border-green-400 p-4 rounded">
          <p class="text-sm text-green-700">{{ successMessage }}</p>
        </div>

        <div *ngIf="errorMessage" class="bg-red-50 border-l-4 border-red-400 p-4 rounded">
          <p class="text-sm text-red-700">{{ errorMessage }}</p>
        </div>

        <form *ngIf="mode === 'login'" [formGroup]="loginForm" (ngSubmit)="onSubmitLogin()" class="mt-8 space-y-6">
          <div>
            <label for="email" class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input id="email" type="email" formControlName="email"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              placeholder="seu@email.com" />
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-gray-700 mb-2">Senha</label>
            <input id="password" type="password" formControlName="password"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              placeholder="••••••••" />
          </div>

          <div class="flex items-center justify-between text-sm">
            <button type="button" class="font-medium text-blue-600 hover:text-blue-500 transition"
                    (click)="switchMode('forgotPassword')">
              Esqueci minha senha
            </button>
            <span *ngIf="expiredSession" class="text-amber-700">Sessão expirada, faça login novamente.</span>
          </div>

          <button type="submit" [disabled]="loginForm.invalid || loading || !authEnabled"
            class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition">
            <span *ngIf="!loading">Entrar</span>
            <span *ngIf="loading" class="flex items-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Entrando...
            </span>
          </button>
        </form>

        <form *ngIf="mode === 'forgotPassword'" [formGroup]="forgotPasswordForm" (ngSubmit)="onSubmitForgotPassword()" class="mt-8 space-y-6">
          <div>
            <label for="forgotEmail" class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input id="forgotEmail" type="email" formControlName="email"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              placeholder="seu@email.com" />
          </div>

          <button type="submit" [disabled]="forgotPasswordForm.invalid || loading || !authEnabled"
            class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition">
            Enviar código
          </button>

          <button type="button" class="w-full text-sm font-medium text-gray-600 hover:text-gray-900 transition" (click)="switchMode('login')">
            Voltar para o login
          </button>
        </form>

        <form *ngIf="mode === 'resetPassword'" [formGroup]="resetPasswordForm" (ngSubmit)="onSubmitResetPassword()" class="mt-8 space-y-6">
          <div>
            <label for="resetEmail" class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input id="resetEmail" type="email" formControlName="email"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              placeholder="seu@email.com" />
          </div>

          <div>
            <label for="resetCode" class="block text-sm font-medium text-gray-700 mb-2">Código</label>
            <input id="resetCode" type="text" formControlName="code"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              placeholder="123456" />
          </div>

          <div>
            <label for="newPassword" class="block text-sm font-medium text-gray-700 mb-2">Nova senha</label>
            <input id="newPassword" type="password" formControlName="newPassword"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              placeholder="••••••••••••" />
          </div>

          <button type="submit" [disabled]="resetPasswordForm.invalid || loading || !authEnabled"
            class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition">
            Redefinir senha
          </button>

          <button type="button" class="w-full text-sm font-medium text-gray-600 hover:text-gray-900 transition" (click)="switchMode('login')">
            Voltar para o login
          </button>
        </form>

        <div class="text-center" *ngIf="mode === 'login'">
          <p class="text-sm text-gray-600">
            Não tem uma conta?
            <a routerLink="/register" class="font-medium text-blue-600 hover:text-blue-500 transition">Registre-se aqui</a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly authEnabled = this.authService.isEnabled();
  readonly expiredSession = this.route.snapshot.queryParamMap.get('expired') === 'true';

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  forgotPasswordForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  resetPasswordForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    code: ['', [Validators.required, Validators.minLength(6)]],
    newPassword: ['', [Validators.required, Validators.minLength(12)]],
  });

  mode: AuthScreenMode = 'login';
  loading = false;
  errorMessage = '';
  successMessage = '';

  onSubmitLogin(): void {
    if (this.loginForm.invalid) {
      return;
    }

    this.loading = true;
    this.clearMessages();

    const { email, password } = this.loginForm.getRawValue();
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/produtos';

    this.authService.login(email, password).subscribe({
      next: () => {
        this.loading = false;
        void this.router.navigateByUrl(returnUrl);
      },
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.message || 'Erro ao fazer login. Tente novamente.';
      },
    });
  }

  onSubmitForgotPassword(): void {
    if (this.forgotPasswordForm.invalid) {
      return;
    }

    this.loading = true;
    this.clearMessages();

    const { email } = this.forgotPasswordForm.getRawValue();

    this.authService.forgotPassword(email).subscribe({
      next: (result) => {
        this.loading = false;
        this.mode = 'resetPassword';
        this.resetPasswordForm.patchValue({ email });
        this.successMessage = result.destination
          ? `Código enviado para ${result.destination}.`
          : 'Código de redefinição enviado com sucesso.';
      },
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.message || 'Erro ao solicitar redefinição de senha.';
      },
    });
  }

  onSubmitResetPassword(): void {
    if (this.resetPasswordForm.invalid) {
      return;
    }

    this.loading = true;
    this.clearMessages();

    const { email, code, newPassword } = this.resetPasswordForm.getRawValue();

    this.authService.resetPasswordConfirm(email, code, newPassword).subscribe({
      next: () => {
        this.loading = false;
        this.mode = 'login';
        this.loginForm.patchValue({ email, password: '' });
        this.successMessage = 'Senha redefinida com sucesso. Faça login com a nova senha.';
      },
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.message || 'Erro ao redefinir senha.';
      },
    });
  }

  switchMode(mode: AuthScreenMode): void {
    this.mode = mode;
    this.clearMessages();

    if (mode === 'resetPassword') {
      const email = this.forgotPasswordForm.get('email')?.value || this.loginForm.get('email')?.value || '';
      this.resetPasswordForm.patchValue({ email });
    }
  }

  private clearMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }
}
