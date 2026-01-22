export const environment = {
  production: false,
  // URLs AWS Lambda + API Gateway (Dev apontando para AWS)
  apiEstoqueUrl: 'https://q99vlf2ppd.execute-api.us-east-1.amazonaws.com/dev/api/v1',
  apiFaturamentoUrl: 'https://r9d99rnsz6.execute-api.us-east-1.amazonaws.com/dev/api/v1',

  // AWS Cognito (Preencher após deploy do AuthStack CDK)
  // Comandos para obter valores:
  // aws cloudformation describe-stacks --stack-name NfeAuth-dev --query 'Stacks[0].Outputs'
  cognitoUserPoolId: 'us-east-1_XXXXXXXXX', // PREENCHER após cdk deploy NfeAuth-dev
  cognitoClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx', // PREENCHER após cdk deploy NfeAuth-dev
  cognitoIdentityPoolId: '', // Opcional (não criado ainda)
  cognitoRegion: 'us-east-1'
};
