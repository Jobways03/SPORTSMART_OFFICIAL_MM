import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';

config({ path: path.join(import.meta.dirname, '.env') });

export default defineConfig({
  schema: path.join(import.meta.dirname, 'prisma', 'schema'),
  engine: 'classic',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
