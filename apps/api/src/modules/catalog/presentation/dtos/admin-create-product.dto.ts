import { IsEmail, IsOptional } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class AdminCreateProductDto extends CreateProductDto {
  @IsOptional()
  @IsEmail()
  sellerEmail?: string;
}
