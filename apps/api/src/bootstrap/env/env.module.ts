import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnvService } from './env.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      envFilePath: ['.env', 'apps/api/.env'],
    }),
  ],
  providers: [EnvService],
  exports: [EnvService],
})
export class EnvModule {}
