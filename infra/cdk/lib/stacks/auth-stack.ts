import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

interface AuthStackProps extends cdk.StackProps {
  config: InfraConfig;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Cognito User Pool com segurança enterprise
    this.userPool = new cognito.UserPool(this, 'NfeUserPool', {
      userPoolName: `nfe-users-${config.environment}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: false,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true, // TOTP via app authenticator
      },
      userVerification: {
        emailSubject: 'Verifique seu email - Sistema NFE',
        emailBody: 'Olá {username}, seu código de verificação é: {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // User Pool Client para web app
    this.userPoolClient = new cognito.UserPoolClient(this, 'NfeWebClient', {
      userPool: this.userPool,
      userPoolClientName: `nfe-web-client-${config.environment}`,
      authFlows: {
        userPassword: true,
        userSrp: true, // Secure Remote Password
      },
      generateSecret: false, // Web apps não podem manter secrets
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: false,
          implicitCodeGrant: false,
        },
      },
    });

    // Domain para Hosted UI (opcional, mas útil para testes)
    this.userPoolDomain = new cognito.UserPoolDomain(this, 'NfeDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: `nfe-auth-${config.environment}-${cdk.Aws.ACCOUNT_ID}`,
      },
    });

    // Outputs para uso em outros stacks
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `NfeUserPoolId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `NfeUserPoolClientId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: `NfeUserPoolArn-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: `${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI Domain',
      exportName: `NfeUserPoolDomain-${config.environment}`,
    });

    // Tags para billing e compliance
    cdk.Tags.of(this).add('Stack', 'Auth');
    cdk.Tags.of(this).add('Environment', config.environment);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('CostCenter', 'NFE-Auth');
  }
}
