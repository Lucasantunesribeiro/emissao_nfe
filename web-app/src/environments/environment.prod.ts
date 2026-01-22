export const environment = {
  production: true,
  // URLs AWS Lambda + API Gateway (Apontando para DEV - único ambiente disponível)
  apiEstoqueUrl: 'https://q99vlf2ppd.execute-api.us-east-1.amazonaws.com/dev/api/v1',
  apiFaturamentoUrl: 'https://r9d99rnsz6.execute-api.us-east-1.amazonaws.com/dev/api/v1',

  // AWS Cognito (TODO: Deploy de ambiente prod)
  cognitoUserPoolId: 'us-east-1_XXXXXXXXX', // PREENCHER após cdk deploy NfeAuth-prod
  cognitoClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx', // PREENCHER após cdk deploy NfeAuth-prod
  cognitoIdentityPoolId: '', // Opcional
  cognitoRegion: 'us-east-1'
};
