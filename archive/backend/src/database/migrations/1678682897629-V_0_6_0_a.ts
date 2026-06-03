import { MigrationInterface, QueryRunner } from "typeorm";

export class V060A1678682897629 implements MigrationInterface {
    name = 'V060A1678682897629'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "e_image_derivative_backend_v2" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "image_id" character varying NOT NULL, "key" character varying NOT NULL, "filetype" character varying NOT NULL, "last_read" TIMESTAMP WITH TIME ZONE NOT NULL, "data" bytea NOT NULL, CONSTRAINT "UQ_d214dd07be2118996e900cff2d4" UNIQUE ("image_id", "key"), CONSTRAINT "PK_f00074bb7a7268d3227cdfbf452" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f7d74de2723367bde5ef284db6" ON "e_image_derivative_backend_v2" ("image_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_c2daefe1e3cf2fdb84a6b1249b" ON "e_image_derivative_backend_v2" ("key") `);
        await queryRunner.query(`CREATE TABLE "e_image_file_backend_v2" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "image_id" character varying NOT NULL, "variant" character varying NOT NULL, "filetype" character varying NOT NULL, "data" bytea NOT NULL, CONSTRAINT "UQ_303a57185f10a62447ebbdc2b7f" UNIQUE ("image_id", "variant"), CONSTRAINT "PK_677b08227794a2363554eed7268" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9f7db4b32b0c34965ae32482fa" ON "e_image_file_backend_v2" ("image_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_624c858cefb5429083b5c910fd" ON "e_image_file_backend_v2" ("variant") `);
        await queryRunner.query(`CREATE TABLE "e_image_backend_v2" ("id" character varying NOT NULL, "user_id" uuid NOT NULL, "created" TIMESTAMP WITH TIME ZONE NOT NULL, "file_name" character varying NOT NULL DEFAULT 'image', "expires_at" TIMESTAMP WITH TIME ZONE, "delete_key" character varying, CONSTRAINT "PK_c227ae010c616ba910e5737ac03" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "e_image_derivative_backend_v2" ADD CONSTRAINT "FK_f7d74de2723367bde5ef284db6e" FOREIGN KEY ("image_id") REFERENCES "e_image_backend_v2"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "e_image_file_backend_v2" ADD CONSTRAINT "FK_9f7db4b32b0c34965ae32482faf" FOREIGN KEY ("image_id") REFERENCES "e_image_backend_v2"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "e_image_file_backend_v2" DROP CONSTRAINT "FK_9f7db4b32b0c34965ae32482faf"`);
        await queryRunner.query(`ALTER TABLE "e_image_derivative_backend_v2" DROP CONSTRAINT "FK_f7d74de2723367bde5ef284db6e"`);
        await queryRunner.query(`DROP TABLE "e_image_backend_v2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_624c858cefb5429083b5c910fd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9f7db4b32b0c34965ae32482fa"`);
        await queryRunner.query(`DROP TABLE "e_image_file_backend_v2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c2daefe1e3cf2fdb84a6b1249b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f7d74de2723367bde5ef284db6"`);
        await queryRunner.query(`DROP TABLE "e_image_derivative_backend_v2"`);
    }

}
