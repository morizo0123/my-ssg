---
title: フェーズ1 - Bun製SSGの基礎実装
date: 2026-05-17
---

# フェーズ1: Bun製SSGの基礎実装

## ゴール

- Bunを使って簡易的なSSG（Static Site Generator）を実装する
- Markdownファイルを読み込み、HTMLテンプレートに流し込んで静的サイトとして出力する
- 開発時はライブリロード付きのローカルサーバーで確認できるようにする

## セットアップ

### Bunのインストール

```bash
curl -fsSL https://bun.sh/install | bash
```

- 常に最新版を使う方針
- アップデートは `bun upgrade` で対応
- バージョン確認: `bun --version`（今回は `1.3.14`）

### プロジェクト初期化

```bash
mkdir my-ssg && cd my-ssg
bun init -y
bun add marked gray-matter
mkdir content templates public
```

| パッケージ    | 役割                                   |
| ------------- | -------------------------------------- |
| `marked`      | Markdown → HTML 変換                   |
| `gray-matter` | フロントマター（YAML部分）を本文と分離 |

## ディレクトリ構成

```
my-ssg/
├── content/          # Markdownファイル（記事の元データ）
├── templates/        # HTMLテンプレート
├── public/           # 静的アセット（CSS、画像など）
├── dist/             # 出力先（ビルドで自動生成）
├── build.ts          # ビルドスクリプト
├── serve.ts          # 開発サーバー
└── package.json
```

## ビルドスクリプト（build.ts）

### 全体の流れ

> Markdownファイル(`content/*.md`)を読む → HTMLに変換 → テンプレートに埋め込む → `dist/`に書き出す

### 主要な処理

#### 1. 簡易テンプレートエンジン

```typescript
function render(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}
```

- 正規表現 `\{\{(\w+)\}\}` で `{{key}}` 形式の箇所を捕まえる
- `(\w+)` がキャプチャグループで、中身（キー名）を取り出す
- `/g` フラグで全箇所を置換
- 対応するキーが無ければ空文字を入れる

#### 2. Markdownの処理フロー

```
content/hello.md
  ↓ Bun.file().text()
"---\ntitle: ...\n---\n# こんにちは..."
  ↓ matter()
{ data: {title, date}, content: "# こんにちは..." }
  ↓ marked()
"<h1>こんにちは</h1>..."
  ↓ render(template, {...})
"<!DOCTYPE html>...<h1>こんにちは</h1>..."
  ↓ Bun.write()
dist/hello.html
```

- `gray-matter` がフロントマターと本文を分離
- `marked` がMarkdown本文をHTMLに変換
- 自作の `render()` でテンプレートに埋め込み

#### 3. ディレクトリの再帰コピー

```typescript
async function copyDir(src: string, dest: string) {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath); // 再帰
    } else {
      await Bun.write(destPath, Bun.file(srcPath));
    }
  }
}
```

- `public/` の中身を `dist/` にそのままコピー
- サブディレクトリがあっても辿れるよう再帰呼び出し

### つまずきポイント

#### `noUncheckedIndexedAccess` によるエラー

```typescript
// エラー: string | undefined を string に割り当てられない
date: new Date().toISOString().split("T")[0],
```

Bunの `tsconfig.json` ではこのオプションが有効になっており、配列の要素アクセスは `string | undefined` 型になる。

**解決方法**: `substring` を使う書き方に変更

```typescript
date: new Date().toISOString().substring(0, 10),
```

`toISOString()` は常に `YYYY-MM-DDTHH:mm:ss.sssZ` 形式の文字列を返すため、`substring(0, 10)` で安全に日付部分を切り出せる。

## 開発サーバー（serve.ts）

### やりたいこと

1. HTTPサーバーを立ち上げ、`dist/` の中身を `localhost:3000` で配信
2. `content/` `templates/` `public/` の変更を監視し、自動で再ビルド
3. 再ビルド後、ブラウザを自動でリロード

### 起動コマンド

`package.json` にスクリプトを追加:

```json
{
  "scripts": {
    "build": "bun run build.ts",
    "dev": "bun run serve.ts"
  }
}
```

```bash
bun run dev
```

### 主要な仕組み

#### 1. `Bun.$` でシェルコマンド実行

```typescript
await Bun.$`bun run build.ts`;
```

- バッククォート内のコマンドをそのまま実行できるBun独自の機能
- `child_process.exec` の代替

#### 2. ファイル監視

```typescript
watch(dir, { recursive: true }, async (event, filename) => {
  await Bun.$`bun run build.ts`;
  for (const client of clients) {
    client.enqueue(`data: reload\n\n`);
  }
});
```

- `node:fs` の `watch` でディレクトリを監視
- 変更検知 → 再ビルド → 全クライアントに通知

#### 3. SSE（Server-Sent Events）でブラウザにリロード指示

**SSEとは**: サーバーが一方的にメッセージを送り続けられる接続。WebSocketより軽量。

```
普通のHTTP:
  ブラウザ → リクエスト → サーバー
  ブラウザ ← レスポンス ← サーバー
  (接続終了)

SSE:
  ブラウザ → 接続要求 → サーバー
  ブラウザ ←←← メッセージ ←←← サーバー（接続を開いたまま）
```

ブラウザ側のスクリプト（HTMLに自動注入）:

```javascript
const es = new EventSource('/__livereload');
es.onmessage = (e) => {
  if (e.data === 'reload') location.reload();
};
```

#### 4. HTMLへのスクリプト注入

```typescript
if (pathname.endsWith(".html")) {
  const html = await file.text();
  const injected = html.replace("</body>", `${liveReloadScript}</body>`);
  return new Response(injected, { ... });
}
```

ビルド済みHTMLファイル自体は汚さず、**配信時のみ** ライブリロード用スクリプトを差し込む。本番ビルドには影響しない設計。

## 学んだ概念

### `ReadableStream` と `ReadableStreamDefaultController`

- **ストリーム** = 少しずつ流れてくるデータ
- **`ReadableStream`** = 読み取り可能なストリーム本体（データが流れる管）
- **`ReadableStreamDefaultController`** = ストリームを操作するリモコン
  - `enqueue(data)`: データを流す
  - `close()`: ストリームを閉じる
  - `error(e)`: エラーで終わらせる

```typescript
new ReadableStream({
  start(controller) {
    controller.enqueue('データ');
    controller.close();
  }
});
```

ライブリロードでは `controller` を `clients` に保存しておき、ファイル変更時に `enqueue` を呼んでブラウザにメッセージを送る。

### `Response` がストリームを受け取れる理由

- HTTPレスポンスのボディは本質的に **「順番に流れるバイト列」= ストリーム**
- `Response` は内部的にストリームを扱うよう設計されている
- 文字列やファイルを渡すと、裏でストリームに変換される
- 自分で `ReadableStream` を作って渡すと、`close()` を呼ぶまで接続が開きっぱなしになる → SSEとして使える

```
普通のレスポンス = 手紙（送ったら終わり）
ストリーム = 電話（切るまで会話できる）
```

### Bunで使った主なAPI

| API                          | 用途                               |
| ---------------------------- | ---------------------------------- |
| `Bun.file(path)`             | ファイル参照を取得（遅延読み込み） |
| `Bun.write(path, content)`   | ファイル書き込み                   |
| `Bun.serve({ port, fetch })` | HTTPサーバー起動                   |
| ``Bun.$`...` ``              | シェルコマンド実行                 |

## 動作確認

```bash
bun run dev
```

1. `http://localhost:3000` にアクセスして `index.html` 表示
2. `content/hello.md` を編集して保存
3. ターミナルに「📝 変更検知」が表示される
4. 自動で再ビルド
5. ブラウザが自動でリロードされ、変更内容が反映される

## 次フェーズに向けて

フェーズ1ではSSGの最小実装ができた。次フェーズでは以下を検討:

- テンプレートエンジンの本格化（レイアウト継承、パーシャル対応）
- シンタックスハイライト（`marked-highlight` + `shiki`）
- タグ・カテゴリ機能とアーカイブページの自動生成
- RSS/sitemap.xml の出力
- ビルドの差分更新（変更されたファイルのみ再生成）
