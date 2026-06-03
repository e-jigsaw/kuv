import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EImageDerivativeBackendV2 } from '../../database/entities/images/image-derivative.entity.v2';
import { EImageFileBackendV2 } from '../../database/entities/images/image-file.entity.v2';
import { EImageBackendV2 } from '../../database/entities/images/image.entity.v2';
import { ImageDBService } from './image-db.service';
import { ImageFileDBService } from './image-file-db.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EImageBackendV2,
      EImageFileBackendV2,
      EImageDerivativeBackendV2,
    ]),
  ],
  providers: [ImageDBService, ImageFileDBService],
  exports: [ImageDBService, ImageFileDBService],
})
export class ImageDBModule {}
