import { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult, PolicyDocument } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Criar verificador JWT (reutilizado entre invocações)
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.CLIENT_ID!,
});

interface TokenPayload {
  sub: string;
  email: string;
  'cognito:username': string;
  'cognito:groups'?: string[];
}

export const handler = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  console.log('Authorizer invoked:', JSON.stringify(event, null, 2));

  try {
    // Extrair token do header Authorization: Bearer <token>
    const token = extractToken(event.authorizationToken);
    if (!token) {
      console.error('Token não encontrado ou formato inválido');
      throw new Error('Unauthorized');
    }

    // Validar JWT com Cognito
    const payload = await verifier.verify(token) as TokenPayload;
    console.log('Token válido:', { sub: payload.sub, email: payload.email });

    // Gerar IAM Policy de Allow
    const policy = generatePolicy(
      payload.sub,
      'Allow',
      event.methodArn,
      {
        userId: payload.sub,
        email: payload.email,
        username: payload['cognito:username'],
        groups: payload['cognito:groups']?.join(',') || '',
      }
    );

    console.log('Policy gerada:', JSON.stringify(policy, null, 2));
    return policy;

  } catch (error) {
    console.error('Erro na validação do token:', error);

    // Token inválido/expirado: retornar Deny
    // IMPORTANTE: Não revelar detalhes do erro ao cliente
    throw new Error('Unauthorized');
  }
};

/**
 * Extrai token do header Authorization
 * Formato esperado: "Bearer <token>"
 */
function extractToken(authHeader: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7).trim();
}

/**
 * Gera IAM Policy para API Gateway
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>
): APIGatewayAuthorizerResult {
  const policyDocument: PolicyDocument = {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      },
    ],
  };

  const authResponse: APIGatewayAuthorizerResult = {
    principalId,
    policyDocument,
  };

  // Adicionar context se fornecido (disponível em event.requestContext.authorizer no Lambda)
  if (context && effect === 'Allow') {
    authResponse.context = context;
  }

  return authResponse;
}
