export const environment = {
  production: false,
  // URLs AWS Lambda + API Gateway (Dev)
  // IMPORTANTE: Após deploy do CDK, obtenha as URLs reais com:
  // aws cloudformation describe-stacks --stack-name NfeComputeServerless-dev --query 'Stacks[0].Outputs'
  apiEstoqueUrl: 'https://qw1si5e837.execute-api.us-east-1.amazonaws.com/dev/api/v1',
  apiFaturamentoUrl: 'https://qwwcj5sale.execute-api.us-east-1.amazonaws.com/dev/api/v1',

  // AWS Cognito (Preencher após deploy do AuthStack CDK)
  // Comandos para obter valores:
  // aws cloudformation describe-stacks --stack-name NfeAuth-dev --query 'Stacks[0].Outputs'
  cognitoUserPoolId: 'us-east-1_XXXXXXXXX',
  cognitoClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
  cognitoIdentityPoolId: '', // Opcional (não criado ainda)
  cognitoRegion: 'us-east-1'
};
