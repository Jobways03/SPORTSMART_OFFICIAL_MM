import { IsEmail } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class AdminCreateProductDto extends CreateProductDto {
  @IsEmail()
  sellerEmail: string;
}
