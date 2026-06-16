import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class FranchiseLoginDto {
  @IsNotEmpty({ message: 'Email or phone number is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(254)
  identifier!: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MaxLength(128)
  password!: string;
}
