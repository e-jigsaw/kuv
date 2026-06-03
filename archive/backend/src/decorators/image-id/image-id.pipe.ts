import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { Fail, FT } from 'picsur-shared/dist/types';

@Injectable()
export class ImageIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (value.length === 64) return value;
    throw Fail(FT.UsrValidation, 'Invalid image id');
  }
}
