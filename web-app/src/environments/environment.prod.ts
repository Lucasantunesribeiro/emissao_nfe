export const environment = {
  production: true,
  // URLs AWS Lambda + API Gateway (Produção)
  // IMPORTANTE: Após deploy do CDK, obtenha as URLs reais com:
  // aws cloudformation describe-stacks --stack-name NfeComputeServerless-prod --query 'Stacks[0].Outputs'
  // DEV Environment APIs (until prod is deployed)
  apiEstoqueUrl: 'https://t5baqexuo5.execute-api.us-east-1.amazonaws.com/dev/api/v1',
  apiFaturamentoUrl: 'https://rtbyoojhhd.execute-api.us-east-1.amazonaws.com/dev/api/v1',

  // AWS Cognito (Preencher após deploy do AuthStack CDK)
  // Comandos para obter valores:
  // aws cloudformation describe-stacks --stack-name NfeAuth-prod --query 'Stacks[0].Outputs'
  cognitoUserPoolId: 'us-east-1_XXXXXXXXX',
  cognitoClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
  cognitoIdentityPoolId: '', // Opcional
  cognitoRegion: 'us-east-1'
};
