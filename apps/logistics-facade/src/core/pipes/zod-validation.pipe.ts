import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Per-route Zod validation pipe. Apply as:
 *
 *   @Post()
 *   @UsePipes(new ZodValidationPipe(CreateShipmentRequest))
 *   create(@Body() body: CreateShipmentRequest) { ... }
 *
 * Throws BadRequestException with a structured `errors` array so the
 * RFC 7807 filter can surface them in the response body under
 * `errors: [{ field, message }, ...]`. Field paths are joined with
 * dots so `items.0.sku` is unambiguous in nested payloads.
 *
 * NOTE: we deliberately do NOT replace the global Nest ValidationPipe
 * (class-validator) — keeping both around lets controllers mix
 * class-validator DTOs and Zod schemas during the migration period.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
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
