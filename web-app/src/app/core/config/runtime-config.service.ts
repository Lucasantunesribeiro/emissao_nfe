import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { RuntimeConfig } from './runtime-config.model';

@Injectable({
  providedIn: 'root',
})
export class RuntimeConfigService {
  private config: RuntimeConfig | null = null;

  async load(): Promise<void> {
    const response = await fetch(environment.runtimeConfigPath, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Falha ao carregar runtime config (${response.status})`);
    }

    const rawConfig = await response.json() as RuntimeConfig;
    this.config = this.normalize(rawConfig);
  }

  get value(): RuntimeConfig {
    if (!this.config) {
      throw new Error('Runtime config ainda não foi carregada.');
    }

    return this.config;
  }

  private normalize(config: RuntimeConfig): RuntimeConfig {
    return {
      ...config,
      api: {
        estoqueUrl: this.normalizeUrl(config.api?.estoqueUrl),
        faturamentoUrl: this.normalizeUrl(config.api?.faturamentoUrl),
      },
      auth: {
        enabled: Boolean(config.auth?.enabled),
        region: config.auth?.region ?? 'us-east-1',
        userPoolId: config.auth?.userPoolId ?? '',
        userPoolClientId: config.auth?.userPoolClientId ?? '',
      },
      observability: {
        enableCorrelationId: config.observability?.enableCorrelationId ?? true,
      },
      ui: {
        environmentName: config.ui?.environmentName ?? (environment.production ? 'Prod' : 'Dev'),
      },
    };
  }

  private normalizeUrl(url: string | undefined): string {
    if (!url) {
      return '';
    }

    return url.endsWith('/') ? url.slice(0, -1) : url;
  }
}
