export const environment = {
  production: true,
  // URLs AWS Lambda + API Gateway (Produção)
  // IMPORTANTE: Após deploy do CDK, obtenha as URLs reais com:
  // aws cloudformation describe-stacks --stack-name NfeComputeServerless-prod --query 'Stacks[0].Outputs'
  apiEstoqueUrl: process.env['API_ESTOQUE_URL'] || 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/api/v1',
  apiFaturamentoUrl: process.env['API_FATURAMENTO_URL'] || 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/api/v1',

  // AWS Cognito (Preencher após deploy do AuthStack CDK)
  // Comandos para obter valores:
  // aws cloudformation describe-stacks --stack-name NfeAuth-prod --query 'Stacks[0].Outputs'
  cognitoUserPoolId: process.env['COGNITO_USER_POOL_ID'] || 'us-east-1_XXXXXXXXX',
  cognitoClientId: process.env['COGNITO_CLIENT_ID'] || 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
  cognitoIdentityPoolId: '', // Opcional
  cognitoRegion: 'us-east-1'
};
