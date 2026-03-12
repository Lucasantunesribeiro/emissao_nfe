import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { authGuard, publicGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

const makeRouterMock = () => ({ navigate: jest.fn() } as unknown as Router);

describe('authGuard', () => {
  it('deve bloquear e redirecionar para /login quando não autenticado', (done) => {
    const routerMock = makeRouterMock();

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { currentUser$: of(null) } },
        { provide: Router, useValue: routerMock },
      ],
    });

    TestBed.runInInjectionContext(() => {
      const result$ = authGuard({} as any, { url: '/notas' } as any) as any;
      result$.subscribe((allowed: boolean) => {
        expect(allowed).toBe(false);
        expect(routerMock.navigate).toHaveBeenCalledWith(['/login'], {
          queryParams: { returnUrl: '/notas' },
        });
        done();
      });
    });
  });

  it('deve permitir acesso quando autenticado', (done) => {
    const user = { userId: '123', email: 'test@test.com', username: 'test' };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { currentUser$: of(user) } },
        { provide: Router, useValue: makeRouterMock() },
      ],
    });

    TestBed.runInInjectionContext(() => {
      const result$ = authGuard({} as any, { url: '/notas' } as any) as any;
      result$.subscribe((allowed: boolean) => {
        expect(allowed).toBe(true);
        done();
      });
    });
  });
});

describe('publicGuard', () => {
  it('deve permitir acesso quando não autenticado', (done) => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { currentUser$: of(null) } },
        { provide: Router, useValue: makeRouterMock() },
      ],
    });

    TestBed.runInInjectionContext(() => {
      const result$ = publicGuard({} as any, {} as any) as any;
      result$.subscribe((allowed: boolean) => {
        expect(allowed).toBe(true);
        done();
      });
    });
  });

  it('deve redirecionar para /produtos quando já autenticado', (done) => {
    const user = { userId: '123', email: 'test@test.com', username: 'test' };
    const routerMock = makeRouterMock();

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { currentUser$: of(user) } },
        { provide: Router, useValue: routerMock },
      ],
    });

    TestBed.runInInjectionContext(() => {
      const result$ = publicGuard({} as any, {} as any) as any;
      result$.subscribe((allowed: boolean) => {
        expect(allowed).toBe(false);
        expect(routerMock.navigate).toHaveBeenCalledWith(['/produtos']);
        done();
      });
    });
  });
});
