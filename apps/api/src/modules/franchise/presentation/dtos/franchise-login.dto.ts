import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class FranchiseLoginDto {
  @IsNotEmpty({ message: 'Email or phone number is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  identifier: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  password: string;
}
