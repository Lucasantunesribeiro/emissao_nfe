export interface RuntimeApiConfig {
  estoqueUrl: string;
  faturamentoUrl: string;
}

export interface RuntimeAuthConfig {
  enabled: boolean;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
}

export interface RuntimeObservabilityConfig {
  enableCorrelationId: boolean;
}

export interface RuntimeUiConfig {
  environmentName: string;
}

export interface RuntimeConfig {
  api: RuntimeApiConfig;
  auth: RuntimeAuthConfig;
  observability: RuntimeObservabilityConfig;
  ui: RuntimeUiConfig;
}
