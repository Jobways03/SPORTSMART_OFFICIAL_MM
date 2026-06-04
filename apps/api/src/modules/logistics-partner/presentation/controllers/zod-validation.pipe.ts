import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Module-local Zod validation pipe. Apps/api uses class-validator
 * globally for most modules but this module's DTOs are Zod-first to
 * stay symmetric with the apps/logistics-facade contracts. Adding a
 * second pipe alongside the global ValidationPipe is fine — Nest
 * applies pipes left-to-right and the global one ignores unknown
 * shapes.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: this.flatten(parsed.error),
    });
  }

  private flatten(error: ZodError): Array<{ field: string; message: string }> {
    return error.issues.map((issue) => ({
      field: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
      message: issue.message,
    }));
  }
}
