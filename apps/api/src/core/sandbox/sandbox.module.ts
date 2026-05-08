import { Global, Module } from '@nestjs/common';
import { SandboxModeService } from './sandbox-mode.service';

@Global()
@Module({
  providers: [SandboxModeService],
  exports: [SandboxModeService],
})
export class SandboxModule {}
