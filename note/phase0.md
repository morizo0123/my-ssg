---
title: フェーズ0 - Bunの基礎
date: 2026-05-17
---

# フェーズ0: Bunの基礎

SSG実装を進める前に、Bunの基礎を一通り整理する。フェーズ1のコードで使った構文・APIを「何だっけ?」とならないようにするのが目的。

## 1. Bunとは

**JavaScript/TypeScriptランタイム + パッケージマネージャ + バンドラ + テストランナー** が1つになったツール。

- Node.jsの代替を狙っている
- Zig言語で書かれている（だから速い）
- Node.js互換APIを持つので、既存のNodeコード資産が大体動く

### Node.jsとの違い

|                | Node.js             | Bun                       |
| -------------- | ------------------- | ------------------------- |
| TypeScript     | トランスパイル必要  | そのまま実行可            |
| パッケージ管理 | npm/yarn/pnpm       | bun（高速）               |
| バンドラ       | webpack等が別途必要 | 内蔵                      |
| テスト         | jest等が別途必要    | 内蔵（`bun test`）        |
| 起動速度       | 普通                | 速い                      |
| 標準API        | Node.js独自         | Web標準API優先（fetch等） |

### 一言まとめ

「Node + npm + ts-node + nodemon + jest を1個にまとめて速くしたやつ」。

## 2. TypeScriptがそのまま動く

```bash
bun run build.ts    # ✓ そのまま動く
node build.ts       # ✗ エラー（tscでJSにする必要あり）
```

Bunは内部でTypeScriptを解析して実行できるので、コンパイル不要。`.ts`ファイルをそのまま実行できる。

ただし「型チェック」はしない。型エラーがあっても走らせるだけなら動くので、本格的なチェックは別途VSCodeやtscでやる、というスタンス。

## 3. パッケージ管理

### コマンド

```bash
bun init -y            # プロジェクト初期化
bun install            # package.jsonの依存をインストール
bun add marked         # 依存追加
bun add -d typescript  # 開発依存に追加（-d = --dev）
bun remove marked      # 削除
bun update             # アップデート
```

### 生成されるファイル

- `package.json` … 依存リスト
- `bun.lockb` … バイナリ形式のロックファイル（npmの`package-lock.json`相当）
- `node_modules/` … 実体

`bun install`はnpmの10〜30倍速いのが売り。

## 4. モジュールシステム

ESM（ECMAScript Modules）が標準。

### import / export

```typescript
// 名前付きエクスポート
export function hello() { ... }
export const PI = 3.14;

// デフォルトエクスポート
export default function main() { ... }

// 名前付きインポート
import { hello, PI } from "./utils.ts";

// デフォルトインポート
import main from "./main.ts";

// まとめてインポート
import * as utils from "./utils.ts";
```

### Node.js組み込みモジュール

```typescript
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
```

`node:`プレフィックスで明示する。これを付けると「Node組み込みモジュールだよ」と一目で分かる。

### npm パッケージ

```typescript
import { marked } from 'marked'; // node_modulesから探す
import matter from 'gray-matter';
```

## 5. Bun独自API（よく使う4つ）

### `Bun.file(path)` - ファイル参照

```typescript
const file = Bun.file('./hello.txt');
await file.text(); // 文字列で読む
await file.json(); // JSONとしてパース
await file.bytes(); // Uint8Arrayで読む
await file.exists(); // 存在チェック
```

ポイント: `Bun.file()`を呼んだ時点ではまだ読み込まれない（遅延評価）。`.text()`等を呼んで初めて読まれる。

### `Bun.write(path, content)` - ファイル書き込み

```typescript
await Bun.write('./out.txt', 'Hello');
await Bun.write('./out.json', { foo: 'bar' }); // JSONも書ける
await Bun.write('./copy.txt', Bun.file('./src.txt')); // コピー
```

### `Bun.serve({ port, fetch })` - HTTPサーバー

```typescript
const server = Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response('Hello!');
  }
});
console.log(`http://localhost:${server.port}`);
```

`fetch(req)`がリクエストハンドラ。`Request`を受けて`Response`を返すWeb標準APIでできている。

### `Bun.$` - シェルコマンド実行

```typescript
await Bun.$`ls -la`;
await Bun.$`bun run build.ts`;

const output = await Bun.$`echo hello`.text(); // 出力を文字列で取得
```

## 6. 非同期処理（async/await）

JS/TSで最重要の構文。Bunのファイル操作・HTTPはほぼ全部非同期なので必須。

### Promiseとは

「未来に結果が返ってくる」値。

```typescript
const promise = Bun.file('./a.txt').text();
// この時点では promise は「読み込み中の約束」
```

### async / await

`await`を使うと「結果が返ってくるまで待つ」ができる:

```typescript
const text = await Bun.file('./a.txt').text();
// ↑ 読み込み完了まで止まる → text に中身が入る
```

`await`を使うには関数を`async`にする必要がある:

```typescript
async function main() {
  const text = await Bun.file('./a.txt').text();
  console.log(text);
}
main();
```

Bunのトップレベルなら`async`関数で囲まなくても`await`が使える（トップレベルawait）:

```typescript
// build.ts 直下でOK
const text = await Bun.file('./a.txt').text();
```

### 並列実行

順番に待つと遅い:

```typescript
// 直列（遅い）: aの読み込み待ち → bの読み込み待ち
const a = await Bun.file('./a.txt').text();
const b = await Bun.file('./b.txt').text();
```

`Promise.all`で並列化:

```typescript
// 並列（速い）: aとbを同時に読む
const [a, b] = await Promise.all([
  Bun.file('./a.txt').text(),
  Bun.file('./b.txt').text()
]);
```

## 7. tsconfig.jsonの注目ポイント

`bun init`が生成する`tsconfig.json`で、つまずきやすいオプション:

```json
{
  "compilerOptions": {
    "strict": true, // 厳格な型チェック
    "noUncheckedIndexedAccess": true, // フェーズ1で遭遇したやつ
    "moduleResolution": "bundler", // Bun流のモジュール解決
    "allowImportingTsExtensions": true, // import "./foo.ts" を許可
    "verbatimModuleSyntax": true // import type の扱いを厳密に
  }
}
```

### `noUncheckedIndexedAccess` の意味

配列やオブジェクトのインデックスアクセスを `T | undefined` 扱いにする。

```typescript
const arr = ['a', 'b', 'c'];
const x = arr[0]; // string | undefined （安全）
const y = arr[0]!; // string （断言、自己責任）

// オフだと x: string になり、実行時に undefined でクラッシュする可能性
```

「型が厳しい」のではなく「現実に即した型」と理解するとよい。

## 8. Web標準API

BunはNode独自APIよりもWeb標準APIを優先採用している。

|            | Node.js流           | Web標準（Bun推奨）                   |
| ---------- | ------------------- | ------------------------------------ |
| HTTP取得   | `http.request`      | `fetch()`                            |
| サーバー   | `http.createServer` | `Bun.serve()` + `Request`/`Response` |
| ファイル   | `fs.readFile`       | `Bun.file()`                         |
| エンコード | `Buffer`            | `Uint8Array`/`TextEncoder`           |

ブラウザで使う知識がそのままサーバーで使えるのが利点。`fetch`/`Request`/`Response`/`ReadableStream`はブラウザのMDNドキュメントがそのまま参考になる。

## 9. よく使うコマンド早見表

```bash
# 実行
bun run script.ts           # スクリプト実行
bun script.ts               # 同上（runは省略可）
bun --watch run script.ts   # ファイル変更で自動再実行

# プロジェクト操作
bun init -y                 # 初期化
bun install                 # 依存インストール
bun add <pkg>               # 追加
bun remove <pkg>            # 削除
bun update                  # 更新

# package.json scripts
bun run dev                 # "dev" スクリプト実行
bun dev                     # 同上（runは省略可）

# その他
bun --version               # バージョン
bun upgrade                 # Bun自体をアップデート
bun test                    # テスト実行
bun build ./src.ts          # バンドル
bun x <pkg>                 # npxの代替（一時実行）
```

## 10. フェーズ1コードの再読み

これを踏まえてフェーズ1の`build.ts`を読み返すと:

```typescript
import { readdir, mkdir, rm } from "node:fs/promises";  // Node互換API
import { marked } from "marked";                        // npmパッケージ

const raw = await Bun.file(path).text();    // Bun独自API、非同期
const html = await marked(content);          // marked自体も非同期
await Bun.write(path, rendered);             // Bun独自API、非同期

async function build() { ... }               // 非同期関数
build().catch(console.error);                // Promiseの後始末
```

ほぼ全部「非同期処理 + Bun API + Node互換」の組み合わせ、ということが見えてくる。

## まとめ

1. Bun = Node代替の高速ランタイム、TS直接実行できる
2. `Bun.file()` / `Bun.write()` / `Bun.serve()` / `Bun.$` が4大API
3. `async/await`は必須、ほぼ全APIが非同期
4. `node:` プレフィックスでNode組み込みモジュールが使える
5. Web標準API優先（`fetch`、`Response`、`ReadableStream`等）
6. `bun add/install/run` が日常コマンド

## 次フェーズに向けて

フェーズ0でBunの土台を整理した。フェーズ1で作ったSSGをフェーズ2でさらに拡張していく:

- シンタックスハイライト（`marked-highlight` + `shiki`）
- テンプレートエンジンの本格化（レイアウト継承、パーシャル）
- タグ・カテゴリ機能とアーカイブページの自動生成
- RSS/sitemap.xml の出力
- ビルドの差分更新
