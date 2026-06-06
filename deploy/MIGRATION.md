# 旧 Picsur CT → kuv 新 CT への blue-green 移行手順

方針: 旧 CT・旧 DB には一切書き込まない（pg_dump の読み取り一度きり）。
新 CT 側のコピーに移行 SQL を適用し、nginx proxy manager (NPM) の切り替えだけで
移行・ロールバックを行う。設計の経緯は
`docs/superpowers/specs/2026-06-03-picsur-rewrite-design.md` の「Phase 5 の移行戦略」を参照。

## 1. 新 CT の作成

Proxmox で新規 CT を作成（Debian 12 以降を想定）。以下をインストール:

```bash
apt-get update && apt-get install -y git docker.io docker-compose-plugin curl
git clone https://github.com/e-jigsaw/Picsur.git /opt/kuv
cd /opt/kuv && git checkout hack
```

## 2. env の用意

```bash
cd /opt/kuv
cat > .env <<EOF
KUV_JWT_SECRET=$(openssl rand -hex 48)
EOF
chmod 600 .env
```

`.env` は docker compose が自動で読む。DB の host/user/password/database は
compose 内で完結している（すべて `kuv`、外部非公開）ので設定不要。

## 3. 新スタックの起動確認（空 DB でのスモーク）

```bash
docker compose up -d --build
# スキーマ適用（migration runner は無いので psql で直接）
docker compose exec -T postgres psql -U kuv -d kuv -v ON_ERROR_STOP=1 \
  < packages/shared/drizzle/0000_nostalgic_baron_zemo.sql
curl -sf http://localhost:8080/ | head -3        # SPA の HTML が返る
curl -s  http://localhost:8080/api/auth/me       # 401 JSON が返る
```

両方返れば caddy / api / postgres の配線は正常。

## 4. 旧 CT から pg_dump を取得（読み取りのみ）

旧 CT 上で（DB 名・ユーザ名は旧 CT の環境変数 `PICSUR_DB_*` を参照。デフォルトは `picsur`）:

```bash
pg_dump -U <旧DBユーザ> -Fc <旧DB名> > /tmp/picsur.dump
```

新 CT 上で（旧 CT から pull）:

```bash
scp <旧CTホスト>:/tmp/picsur.dump /opt/kuv/picsur.dump
```

## 5. 新 CT で restore（kuv DB を作り直してから）

§3 のスモークで入れた空スキーマは捨てて、dump から作り直す:

```bash
cd /opt/kuv
docker compose stop api                  # restore 中の書き込みを防ぐ
docker compose exec postgres dropdb --force -U kuv kuv
docker compose exec postgres createdb -U kuv kuv
docker compose exec -T postgres pg_restore -U kuv -d kuv --no-owner --no-privileges \
  < picsur.dump
```

`--no-owner --no-privileges` は必須（旧 DB の role 名は新 postgres に存在しない）。
`--force` は残存接続を切ってから drop する（psql セッションの閉じ忘れ対策）。

## 6. 移行 SQL の適用

```bash
docker compose exec -T postgres psql -U kuv -d kuv -v ON_ERROR_STOP=1 \
  < deploy/migrate-from-picsur.sql
```

- 全体が 1 トランザクション。エラーで止まったら何も変わっていない（再試行は原因を直してから同じコマンドでよい）。
- `NOTICE: images with expires_at set ...: 0` を確認（0 でなければ期限付き画像が存在する。期限は移行されないことを了解の上で進めるか判断）。
- fail-closed ガードで中断するケース:
  - `ERROR: aborting: N image(s) owned by non-admin or unknown users` — admin 以外の所有画像がある。対処を決めてから再実行（勝手に消さない）
  - `ERROR: aborting: expected exactly 1 user (admin) after cleanup, found N` — dump に admin ユーザがいない。dump の取得元を確認
  - `ERROR: aborting: unexpected keep_original value ...` — preference の値が想定外。値を確認してから判断
- 上記以外のエラー（例: 旧 DB に view 等の想定外の依存オブジェクトがあって ALTER が失敗）で止まった場合も全ロールバックされているので、コピー DB を §5 から作り直せばよい。旧系統は常に無傷。

## 7. schema diff 検証

移行結果が drizzle ベースラインと完全一致することを機械的に確認する:

```bash
docker compose exec postgres createdb -U kuv baseline
docker compose exec -T postgres psql -U kuv -d baseline -v ON_ERROR_STOP=1 \
  < packages/shared/drizzle/0000_nostalgic_baron_zemo.sql
docker compose exec -T postgres pg_dump -U kuv --schema-only baseline | grep -vE '^\\(un)?restrict' > /tmp/baseline.sql
docker compose exec -T postgres pg_dump -U kuv --schema-only kuv      | grep -vE '^\\(un)?restrict' > /tmp/migrated.sql
diff /tmp/baseline.sql /tmp/migrated.sql && echo "SCHEMA MATCH"
docker compose exec postgres dropdb -U kuv baseline
```

`SCHEMA MATCH` が出なければ差分を確認して止まる（diff の内容が対処方針の判断材料になる）。

## 8. 動作確認チェックリスト

```bash
docker compose start api
```

- [ ] `http://<新CTホスト>:8080/` で SPA が開く
- [ ] 旧パスワードで admin ログインできる
- [ ] 画像一覧に既存画像が出る・クリックして表示できる（`GET /i/<id>` が 200）
- [ ] 既存の ShareX apikey でアップロードできる:
  ```bash
  curl -s -H "Authorization: Api-Key <既存キー>" \
    -F "file=@/tmp/test.png" http://localhost:8080/api/image
  ```
- [ ] settings 画面の keep_original が旧設定値と一致している

## 9. NPM の切り替え

nginx proxy manager の該当 proxy host の転送先を
`<旧CTホスト>:<旧ポート>` → `<新CTホスト>:8080` に変更。

## 10. 様子見と旧 CT の停止

- 数日〜1週間ほど通常利用して問題ないことを確認
- **ロールバック**: NPM の転送先を旧 CT に戻すだけ（旧系統は無傷で並走している）
- 問題なければ旧 CT を停止（Proxmox 上で shutdown。削除はさらに様子を見てから）
