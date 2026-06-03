import { ImageEntryVariant } from 'picsur-shared/dist/dto/image-entry-variant.enum';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { EImageBackendV2 } from './image.entity.v2';

@Entity()
@Unique(['image_id', 'variant'])
export class EImageFileBackendV2 {
  @PrimaryGeneratedColumn('uuid')
  private _id?: string;

  // We do a little trickery
  @Index()
  @ManyToOne(() => EImageBackendV2, (image) => image.files, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'image_id' })
  private _image?: any;

  @Column({
    name: 'image_id',
  })
  image_id: string;

  @Index()
  @Column({ nullable: false, enum: ImageEntryVariant })
  variant: ImageEntryVariant;

  @Column({ nullable: false })
  filetype: string;

  // Binary data
  @Column({ type: 'bytea', nullable: false })
  data: Buffer;
}
