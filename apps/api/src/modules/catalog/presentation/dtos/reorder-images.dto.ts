import { IsArray, IsUUID } from 'class-validator';

export class ReorderImagesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  imageIds: string[];
}
