import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface FrontendStackProps extends cdk.StackProps {
  config: InfraConfig;
}

export class FrontendStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly cloudFrontUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { config } = props;

    // S3 Bucket para hospedagem do Angular (privado)
    this.bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `nfe-frontend-${config.environment}-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.environment !== 'prod',
      versioned: config.environment === 'prod',
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: config.environment === 'prod',
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    // Origin Access Identity (OAI) para CloudFront acessar S3 privado
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for NFe Frontend ${config.environment}`,
    });

    // Permitir CloudFront ler do S3
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects('*')],
        principals: [
          new iam.CanonicalUserPrincipal(
            oai.cloudFrontOriginAccessIdentityS3CanonicalUserId
          ),
        ],
      })
    );

    // Cache Policy: Assets (CSS, JS, images) - cache longo
    const assetsCachePolicy = new cloudfront.CachePolicy(this, 'AssetsCachePolicy', {
      cachePolicyName: `nfe-assets-cache-${config.environment}`,
      comment: 'Cache policy for static assets',
      defaultTtl: cdk.Duration.seconds(config.frontend.defaultTtl),
      minTtl: cdk.Duration.seconds(config.frontend.minTtl),
      maxTtl: cdk.Duration.seconds(config.frontend.maxTtl),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    // Cache Policy: HTML - cache curto
    const htmlCachePolicy = new cloudfront.CachePolicy(this, 'HtmlCachePolicy', {
      cachePolicyName: `nfe-html-cache-${config.environment}`,
      comment: 'Cache policy for HTML files',
      defaultTtl: cdk.Duration.seconds(300), // 5 minutos
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(600), // 10 minutos
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    // Security Headers Policy (OWASP Best Practices)
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `nfe-security-headers-${config.environment}`,
      comment: 'Security headers following OWASP best practices',
      securityHeadersBehavior: {
        // Previne clickjacking attacks
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        // HSTS: Force HTTPS por 1 ano
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        // Previne MIME type sniffing
        contentTypeOptions: {
          override: true,
        },
        // XSS Protection (legacy mas útil em navegadores antigos)
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
        // Content Security Policy (CSP)
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'", // unsafe-inline necessário para Angular
            "style-src 'self' 'unsafe-inline'",  // unsafe-inline necessário para Tailwind
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            `connect-src 'self' https://*.execute-api.${cdk.Aws.REGION}.amazonaws.com https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com`,
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
          override: true,
        },
        // Referrer Policy
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      // Headers customizados adicionais
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
            override: true,
          },
        ],
      },
    });

    // CloudFront Distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `NFe Frontend Distribution ${config.environment}`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass[config.frontend.priceClass as keyof typeof cloudfront.PriceClass],
      enableLogging: config.environment === 'prod',
      logBucket: config.environment === 'prod'
        ? new s3.Bucket(this, 'LogBucket', {
            bucketName: `nfe-cloudfront-logs-${config.environment}-${cdk.Aws.ACCOUNT_ID}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            lifecycleRules: [
              {
                expiration: cdk.Duration.days(90),
              },
            ],
          })
        : undefined,
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: htmlCachePolicy,
        responseHeadersPolicy: securityHeadersPolicy,
      },
      additionalBehaviors: {
        '/assets/*': {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity: oai,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: true,
          cachePolicy: assetsCachePolicy,
        },
        '*.js': {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity: oai,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: true,
          cachePolicy: assetsCachePolicy,
        },
        '*.css': {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity: oai,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: true,
          cachePolicy: assetsCachePolicy,
        },
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    this.cloudFrontUrl = `https://${this.distribution.distributionDomainName}`;

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'Frontend S3 bucket name',
      exportName: `NfeFrontendBucket-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
      exportName: `NfeDistributionId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: this.cloudFrontUrl,
      description: 'CloudFront URL',
      exportName: `NfeCloudFrontUrl-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DeployCommand', {
      value: `aws s3 sync ./dist s3://${this.bucket.bucketName}/ && aws cloudfront create-invalidation --distribution-id ${this.distribution.distributionId} --paths "/*"`,
      description: 'Command to deploy frontend and invalidate cache',
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
