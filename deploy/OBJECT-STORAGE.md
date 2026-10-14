# 画像バイナリの object storage 切り替え手順

bytea (image_file / image_derivative) から S3 互換ストレージへの一括移行。api を止めて行う。

## 事前

1. S3 互換ストレージに bucket を作り、その bucket だけを読み書きできるアクセスキーを発行する
2. `.env` に `KUV_S3_ENDPOINT` / `KUV_S3_BUCKET` / `KUV_S3_ACCESS_KEY` / `KUV_S3_SECRET_KEY` (必要なら `KUV_S3_REGION`) を足す
3. 現行 (S3 対応前) の api イメージにロールバック用のタグを付けてから、新しい api イメージをビルドする。ビルドすると compose のイメージタグが新イメージで上書きされるので、先にタグを付けておくこと
   ```bash
   docker compose images api            # 現行イメージの名前 (Repository 列、通常 <compose project>-api) を確認
   docker tag <compose project>-api <compose project>-api:pre-s3
   docker compose build api
   ```
4. 本番ストレージ (古い MinIO、RELEASE.2023-03 世代) との互換性はテストで担保していない。api を止める前に `docker compose run --rm api node dist/scripts/migrate-blobs.js` を一度流して、実 bucket への接続・認証を確認する (copy は冪等で、旧 api が動いたままでも安全)

## 当日

1. api を止める: `docker compose stop api`
2. migration を適用する: `packages/shared/drizzle/0001_*.sql` を本番 DB に流す (data 列の NOT NULL を外すだけ)
3. コピー: `docker compose run --rm api node dist/scripts/migrate-blobs.js`
4. 検証: `docker compose run --rm api node dist/scripts/migrate-blobs.js --verify` が exit 0 になるまで 3 → 4 を繰り返す (copy は冪等)。exit code だけだと CLI が実行されていなくても 0 になりうるので、出力の `verify done: checked=N` の N が次の SQL の結果と一致することも必ず確認する
   ```sql
   select (select count(*) from image_file) + (select count(*) from image_derivative);
   ```
5. 起動: `docker compose up -d api`
6. UI で一覧・表示・形式変換 (`/i/<id>.webp`)・`?variant=original`・アップロード・削除を確認する

## ロールバック

事前に付けた `pre-s3` タグのイメージで api を起動し直す (再ビルドはしない)。

```bash
docker compose stop api
# 一時的な override で image を差し替え、--no-build で起動する
cat > docker-compose.rollback.yml <<'YML'
services:
  api:
    image: <compose project>-api:pre-s3
YML
docker compose -f docker-compose.yml -f docker-compose.rollback.yml up -d --no-build api
```

data 列は残っていて新コードは書き込まないので、移行前の画像はそのまま読める。切り替え後にアップロードした画像は旧コードの一覧には出るが、data が NULL なので表示は失敗する。

再度新コードに切り替える時は、その間に旧コードが bytea に新しい行を書いている可能性があるので、「当日」の 3 (コピー) と 4 (検証) をやり直してから起動する。ロールバック後は `docker-compose.rollback.yml` を消すこと。

## 後始末 (様子見後、別作業)

data 列の drop と `VACUUM FULL image_file, image_derivative` で DB の容量を回収する。
