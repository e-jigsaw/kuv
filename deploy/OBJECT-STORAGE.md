# 画像バイナリの object storage 切り替え手順

bytea (image_file / image_derivative) から S3 互換ストレージへの一括移行。api を止めて行う。

## 事前

1. S3 互換ストレージに bucket を作り、その bucket だけを読み書きできるアクセスキーを発行する
2. `.env` に `KUV_S3_ENDPOINT` / `KUV_S3_BUCKET` / `KUV_S3_ACCESS_KEY` / `KUV_S3_SECRET_KEY` (必要なら `KUV_S3_REGION`) を足す
3. 新しい api イメージをビルドしておく (`docker compose build api`)
4. 本番ストレージ (古い MinIO、RELEASE.2023-03 世代) との互換性はテストで担保していない。api を止める前に `docker compose run --rm api node dist/scripts/migrate-blobs.js` を一度流して、実 bucket への接続・認証を確認する (copy は冪等で、旧 api が動いたままでも安全)

## 当日

1. api を止める: `docker compose stop api`
2. migration を適用する: `packages/shared/drizzle/0001_*.sql` を本番 DB に流す (data 列の NOT NULL を外すだけ)
3. コピー: `docker compose run --rm api node dist/scripts/migrate-blobs.js`
4. 検証: `docker compose run --rm api node dist/scripts/migrate-blobs.js --verify` が exit 0 になるまで 3 → 4 を繰り返す (copy は冪等)
5. 起動: `docker compose up -d api`
6. UI で一覧・表示・形式変換 (`/i/<id>.webp`)・`?variant=original`・アップロード・削除を確認する

## ロールバック

旧イメージで api を起動し直す。data 列は残っていて新コードは書き込まないので、移行前の画像はそのまま読める。ただし切り替え後にアップロードした画像は旧コードからは見えない (data が NULL)。

## 後始末 (様子見後、別作業)

data 列の drop と `VACUUM FULL image_file, image_derivative` で DB の容量を回収する。
