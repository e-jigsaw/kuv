import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types';
import { FindResult } from 'picsur-shared/dist/types/find-result';
import { generateRandomString } from 'picsur-shared/dist/util/random';
import { In, LessThan, Repository } from 'typeorm';
import { EImageBackendV2 } from '../../database/entities/images/image.entity.v2';

@Injectable()
export class ImageDBService {
  constructor(
    @InjectRepository(EImageBackendV2)
    private readonly imageRepo: Repository<EImageBackendV2>,
  ) {}

  public async create(
    hash: string,
    userid: string,
    filename: string,
    withDeleteKey: boolean,
  ): AsyncFailable<EImageBackendV2> {
    let imageEntity = new EImageBackendV2();
    imageEntity.id = hash;
    imageEntity.user_id = userid;
    imageEntity.created = new Date();
    imageEntity.file_name = filename;
    if (withDeleteKey) imageEntity.delete_key = generateRandomString(32);

    try {
      imageEntity = await this.imageRepo.save(imageEntity, {
        reload: true,
      });

      if (imageEntity.delete_key === null) delete imageEntity.delete_key;
      return imageEntity;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findOne(
    id: string,
    userid: string | undefined,
  ): AsyncFailable<EImageBackendV2> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, user_id: userid },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');
      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async findMany(
    count: number,
    page: number,
    userid: string | undefined,
  ): AsyncFailable<FindResult<EImageBackendV2>> {
    if (count < 1 || page < 0) return Fail(FT.UsrValidation, 'Invalid page');
    if (count > 100) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const [found, amount] = await this.imageRepo.findAndCount({
        skip: count * page,
        take: count,
        order: { created: 'DESC' },
        where: {
          user_id: userid,
        },
      });

      if (found === undefined) return Fail(FT.NotFound, 'Images not found');

      return {
        results: found,
        total: amount,
        page,
        pages: Math.ceil(amount / count),
      };
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async count(): AsyncFailable<number> {
    try {
      return await this.imageRepo.count();
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async update(
    id: string,
    userid: string | undefined,
    options: Partial<Pick<EImageBackendV2, 'file_name' | 'expires_at'>>,
  ): AsyncFailable<EImageBackendV2> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, user_id: userid },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');

      if (options.file_name !== undefined) found.file_name = options.file_name;

      if (options.expires_at !== undefined)
        found.expires_at = options.expires_at;

      await this.imageRepo.save(found);

      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async delete(
    ids: string[],
    userid: string | undefined,
  ): AsyncFailable<EImageBackendV2[]> {
    if (ids.length === 0) return [];
    if (ids.length > 500) return Fail(FT.UsrValidation, 'Too many results');

    try {
      const deletable_images = await this.imageRepo.find({
        where: {
          id: In(ids),
          user_id: userid,
        },
      });

      const available_ids = deletable_images.map((i) => i.id);

      if (available_ids.length === 0)
        return Fail(FT.NotFound, 'Images not found');

      await this.imageRepo.delete({ id: In(available_ids) });

      return deletable_images;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async deleteWithKey(
    id: string,
    key: string,
  ): AsyncFailable<EImageBackendV2> {
    try {
      const found = await this.imageRepo.findOne({
        where: { id, delete_key: key },
      });

      if (!found) return Fail(FT.NotFound, 'Image not found');

      await this.imageRepo.delete({ id: found.id });

      return found;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }

  public async deleteAll(IAmSure: boolean): AsyncFailable<true> {
    if (!IAmSure)
      return Fail(
        FT.SysValidation,
        'You must confirm that you want to delete all images',
      );

    try {
      await this.imageRepo.delete({});
    } catch (e) {
      return Fail(FT.Database, e);
    }
    return true;
  }

  public async cleanupExpired(): AsyncFailable<number> {
    try {
      const res = await this.imageRepo.delete({
        expires_at: LessThan(new Date()),
      });

      return res.affected ?? 0;
    } catch (e) {
      return Fail(FT.Database, e);
    }
  }
}
