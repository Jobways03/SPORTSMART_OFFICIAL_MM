import { ConsoleLogger, Injectable } from '@nestjs/common';

@Injectable()
export class AppLoggerService extends ConsoleLogger {
  setContext(context: string) {
    super.setContext(context);
  }
}
