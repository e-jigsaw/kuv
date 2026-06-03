import { EImage } from 'picsur-shared/dist/entities/image.entity';
import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { EImageDerivativeBackendV2 } from './image-derivative.entity.v2';
import { EImageFileBackendV2 } from './image-file.entity.v2';

@Entity()
export class EImageBackendV2 implements EImage {
  @PrimaryColumn()
  id: string;

  @Column({
    nullable: false,
    type: 'uuid',
  })
  user_id: string;

  @Column({
    type: 'timestamptz',
    nullable: false,
  })
  created: Date;

  @Column({
    nullable: false,
    default: 'image',
  })
  file_name: string;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  expires_at: Date | null;

  @Column({
    nullable: true,
    select: false,
  })
  delete_key?: string;

  @OneToMany(
    () => EImageDerivativeBackendV2,
    (derivative) => derivative.image_id,
  )
  derivatives: EImageDerivativeBackendV2[];

  @OneToMany(() => EImageFileBackendV2, (file) => file.image_id)
  files: EImageFileBackendV2[];
}
