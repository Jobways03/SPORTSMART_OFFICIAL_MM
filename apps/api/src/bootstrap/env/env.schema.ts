import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),

  APP_NAME: z.string().default('sportsmart-api'),
  APP_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),

  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().min(1),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('7d'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // S3 - optional in dev
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Razorpay - optional
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  // Shiprocket - optional
  SHIPROCKET_EMAIL: z.string().optional(),
  SHIPROCKET_PASSWORD: z.string().optional(),

  // OpenSearch - optional
  OPENSEARCH_NODE: z.string().optional(),

  // Cloudinary - optional in dev
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Mail (Nodemailer)
  MAIL_HOST: z.string().default('smtp.gmail.com'),
  MAIL_PORT: z.coerce.number().default(587),
  MAIL_SECURE: z.string().default('false'),
  MAIL_USER: z.string().optional(),
  MAIL_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  // Admin Seed
  ADMIN_SEED_NAME: z.string().optional(),
  ADMIN_SEED_EMAIL: z.string().optional(),
  ADMIN_SEED_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
