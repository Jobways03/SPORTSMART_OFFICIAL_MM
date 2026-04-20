import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { UploadFranchiseMediaUseCase } from '../../application/use-cases/upload-franchise-media.use-case';
import { DeleteFranchiseMediaUseCase } from '../../application/use-cases/delete-franchise-media.use-case';

const MULTER_OPTIONS = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
};

@ApiTags('Franchise Profile')
@Controller('franchise/profile/media')
@UseGuards(FranchiseAuthGuard)
export class FranchiseMediaController {
  constructor(
    private readonly uploadFranchiseMediaUseCase: UploadFranchiseMediaUseCase,
    private readonly deleteFranchiseMediaUseCase: DeleteFranchiseMediaUseCase,
  ) {}

  @Patch('profile-image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image', MULTER_OPTIONS))
  async uploadProfileImage(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.uploadFranchiseMediaUseCase.execute(
      franchiseId,
      file,
      'profile-image',
    );

    return {
      success: true,
      message: 'Profile image uploaded successfully',
      data,
    };
  }

  @Delete('profile-image')
  @HttpCode(HttpStatus.OK)
  async deleteProfileImage(@Req() req: Request) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.deleteFranchiseMediaUseCase.execute(
      franchiseId,
      'profile-image',
    );

    return {
      success: true,
      message: 'Profile image removed successfully',
      data,
    };
  }

  @Patch('logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('image', MULTER_OPTIONS))
  async uploadLogo(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.uploadFranchiseMediaUseCase.execute(
      franchiseId,
      file,
      'logo',
    );

    return {
      success: true,
      message: 'Logo uploaded successfully',
      data,
    };
  }

  @Delete('logo')
  @HttpCode(HttpStatus.OK)
  async deleteLogo(@Req() req: Request) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.deleteFranchiseMediaUseCase.execute(
      franchiseId,
      'logo',
    );

    return {
      success: true,
      message: 'Logo removed successfully',
      data,
    };
  }
}
