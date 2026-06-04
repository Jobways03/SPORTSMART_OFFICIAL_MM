import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';

// Same shape as apps/api/prisma.config.ts. The datasource URL is also
// declared in prisma/schema/index.prisma (datasource.url = env(...));
// the value here takes precedence at runtime.
config({ path: path.join(import.meta.dirname, '.env') });

export default defineConfig({
  schema: path.join(import.meta.dirname, 'prisma', 'schema'),
  engine: 'classic',
  datasource: {
    url: process.env.LOGISTICS_DATABASE_URL!,
  },
});
