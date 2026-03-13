import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const examplePath = resolve(rootDir, 'src/assets/config/app-config.example.json');
const outputPath = resolve(rootDir, 'src/assets/config/app-config.json');

const baseConfig = JSON.parse(readFileSync(examplePath, 'utf8'));

const runtimeConfig = {
  ...baseConfig,
  api: {
    estoqueUrl: process.env.API_ESTOQUE_URL ?? baseConfig.api.estoqueUrl,
    faturamentoUrl: process.env.API_FATURAMENTO_URL ?? baseConfig.api.faturamentoUrl,
  },
  auth: {
    enabled: (process.env.AUTH_ENABLED ?? `${baseConfig.auth.enabled}`) === 'true',
    region: process.env.COGNITO_REGION ?? baseConfig.auth.region,
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? baseConfig.auth.userPoolId,
    userPoolClientId: process.env.COGNITO_USER_POOL_CLIENT_ID ?? baseConfig.auth.userPoolClientId,
  },
  observability: {
    enableCorrelationId:
      (process.env.ENABLE_CORRELATION_ID ?? `${baseConfig.observability.enableCorrelationId}`) !== 'false',
  },
  ui: {
    environmentName: process.env.APP_ENVIRONMENT_NAME ?? baseConfig.ui.environmentName,
  },
};

writeFileSync(outputPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, 'utf8');

console.log(`Runtime config generated at ${outputPath}`);
