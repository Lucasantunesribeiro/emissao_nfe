import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({ region: 'us-east-1' });

export const handler = async (event) => {
  console.log('CORS Proxy - Request:', JSON.stringify(event, null, 2));

  try {
    // Invocar Lambda Estoque original
    const command = new InvokeCommand({
      FunctionName: 'nfe-estoque-dev',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(event),
    });

    const response = await lambda.send(command);
    const payload = JSON.parse(new TextDecoder().decode(response.Payload));

    console.log('Lambda Estoque response:', payload);

    // Adicionar headers CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Request-Id',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    };

    return {
      ...payload,
      headers: {
        ...(payload.headers || {}),
        ...corsHeaders,
      },
    };
  } catch (error) {
    console.error('Error invoking Lambda Estoque:', error);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Request-Id',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
