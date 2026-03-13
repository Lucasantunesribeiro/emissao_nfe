import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-12">
      <div class="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl shadow-2xl">
        <div class="text-center">
          <div class="mx-auto h-16 w-16 bg-orange-600 rounded-full flex items-center justify-center mb-4">
            <svg class="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path>
            </svg>
          </div>
          <h2 class="text-3xl font-bold text-gray-900">Criar Conta</h2>
          <p class="mt-2 text-sm text-gray-600">
            {{ awaitingConfirmation ? 'Confirme o email para ativar a conta' : 'Preencha os dados para se cadastrar' }}
          </p>
        </div>

        <div *ngIf="!authEnabled" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          O Cognito não está configurado neste ambiente. Use o runtime config ou o deploy automatizado para habilitar autenticação.
        </div>

        <div *ngIf="errorMessage" class="bg-red-50 border-l-4 border-red-400 p-4 rounded">
          <p class="text-sm text-red-700">{{ errorMessage }}</p>
        </div>

        <div *ngIf="successMessage" class="bg-green-50 border-l-4 border-green-400 p-4 rounded">
          <p class="text-sm text-green-700">{{ successMessage }}</p>
        </div>

        <form *ngIf="!awaitingConfirmation" [formGroup]="registerForm" (ngSubmit)="onSubmitRegister()" class="mt-8 space-y-6">
          <div>
            <label for="nome" class="block text-sm font-medium text-gray-700 mb-2">Nome completo</label>
            <input id="nome" type="text" formControlName="nome"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              placeholder="João Silva" />
          </div>

          <div>
            <label for="email" class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input id="email" type="email" formControlName="email"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              placeholder="seu@email.com" />
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-gray-700 mb-2">Senha</label>
            <input id="password" type="password" formControlName="password"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              placeholder="••••••••••••" />
            <p class="mt-1 text-xs text-gray-500">Mínimo de 12 caracteres para acompanhar a política do Cognito.</p>
          </div>

          <div>
            <label for="confirmPassword" class="block text-sm font-medium text-gray-700 mb-2">Confirmar senha</label>
            <input id="confirmPassword" type="password" formControlName="confirmPassword"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              placeholder="••••••••••••" />
            <p *ngIf="registerForm.hasError('passwordMismatch') && registerForm.get('confirmPassword')?.touched" class="mt-1 text-sm text-red-600">Senhas não conferem.</p>
          </div>

          <div class="flex items-center">
            <input id="terms" type="checkbox" formControlName="acceptTerms"
              class="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded" />
            <label for="terms" class="ml-2 block text-sm text-gray-700">
              Aceito os termos de uso e a política de privacidade.
            </label>
          </div>

          <button type="submit" [disabled]="registerForm.invalid || loading || !authEnabled"
            class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition">
            <span *ngIf="!loading">Criar conta</span>
            <span *ngIf="loading" class="flex items-center">
              <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Criando conta...
            </span>
          </button>
        </form>

        <form *ngIf="awaitingConfirmation" [formGroup]="confirmationForm" (ngSubmit)="onSubmitConfirmation()" class="mt-8 space-y-6">
          <div>
            <label for="confirmationEmail" class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input id="confirmationEmail" type="email" formControlName="email"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              placeholder="seu@email.com" />
          </div>

          <div>
            <label for="confirmationCode" class="block text-sm font-medium text-gray-700 mb-2">Código de confirmação</label>
            <input id="confirmationCode" type="text" formControlName="code"
              class="appearance-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              placeholder="123456" />
          </div>

          <button type="submit" [disabled]="confirmationForm.invalid || loading || !authEnabled"
            class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition">
            Confirmar cadastro
          </button>

          <button type="button" class="w-full text-sm font-medium text-orange-600 hover:text-orange-500 transition" (click)="onResendCode()">
            Reenviar código
          </button>
        </form>

        <div class="text-center">
          <p class="text-sm text-gray-600">
            Já tem uma conta?
            <a routerLink="/login" class="font-medium text-orange-600 hover:text-orange-500 transition">Entre aqui</a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly authEnabled = this.authService.isEnabled();

  registerForm: FormGroup = this.fb.group({
    nome: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    confirmPassword: ['', [Validators.required]],
    acceptTerms: [false, [Validators.requiredTrue]],
  }, { validators: this.passwordMatchValidator });

  confirmationForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    code: ['', [Validators.required, Validators.minLength(6)]],
  });

  awaitingConfirmation = false;
  loading = false;
  errorMessage = '';
  successMessage = '';

  onSubmitRegister(): void {
    if (this.registerForm.invalid) {
      return;
    }

    this.loading = true;
    this.clearMessages();

    const { nome, email, password } = this.registerForm.getRawValue();

    this.authService.register(email, password, nome).subscribe({
      next: (result) => {
        this.loading = false;
        this.confirmationForm.patchValue({ email: result.username });

        if (result.requiresConfirmation) {
          this.awaitingConfirmation = true;
          this.successMessage = result.destination
            ? `Conta criada. Código enviado para ${result.destination}.`
            : 'Conta criada. Informe o código recebido por email.';
          return;
        }

        this.successMessage = 'Conta criada com sucesso. Redirecionando para login...';
        setTimeout(() => void this.router.navigate(['/login']), 1500);
      },
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.message || 'Erro ao criar conta. Tente novamente.';
      },
    });
  }

  onSubmitConfirmation(): void {
    if (this.confirmationForm.invalid) {
      return;
    }

    this.loading = true;
    this.clearMessages();

    const { email, code } = this.confirmationForm.getRawValue();

    this.authService.confirmRegistration(email, code).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Cadastro confirmado com sucesso. Faça login para continuar.';
        setTimeout(() => void this.router.navigate(['/login'], {
          queryParams: { email },
        }), 1200);
      },
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.message || 'Erro ao confirmar cadastro.';
      },
    });
  }

  onResendCode(): void {
    const email = this.confirmationForm.get('email')?.value;
    if (!email) {
      this.errorMessage = 'Informe o email para reenviar o código.';
      return;
    }

    this.loading = true;
    this.clearMessages();

    this.authService.resendConfirmationCode(email).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Novo código enviado com sucesso.';
      },
      error: (error) => {
        this.loading = false;
        this.errorMessage = error.message || 'Erro ao reenviar código.';
      },
    });
  }

  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { passwordMismatch: true };
  }

  private clearMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }
}
