import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class IdempotenciaService {
  gerarChave(): string {
    return crypto.randomUUID();
  }
}
