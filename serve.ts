import { watch } from 'node:fs';
import { join } from 'node:path';

const DIST_DIR = './dist';
const PORT = 3000;

// SSE接続を保持するクライアント一覧
const clients = new Set<ReadableStreamDefaultController>();

// 起動時に1回ビルド
await Bun.$`bun run build.ts`;

// ファイル変更を監視して再ビルド
const watchDirs = ['./content', './templates', './public'];
for (const dir of watchDirs) {
  watch(dir, { recursive: true }, async (event, filename) => {
    console.log(`📝 変更検知: ${filename}`);
    try {
      await Bun.$`bun run build.ts`;
      // 全クライアントにリロード通知
      for (const client of clients) {
        client.enqueue(`data: reload\n\n`);
      }
    } catch (e) {
      console.error('ビルドエラー:', e);
    }
  });
}

// ブラウザに注入するライブリロード用スクリプト
const liveReloadScript = `
<script>
  const es = new EventSource("/__livereload");
  es.onmessage = (e) => {
    if (e.data === "reload") location.reload();
  };
</script>
`;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // ライブリロード用のSSEエンドポイント
    if (url.pathname === '/__livereload') {
      const stream = new ReadableStream({
        start(controller) {
          clients.add(controller);
        },
        cancel() {
          // 切断時のクリーンアップは下のreturn時に
        }
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        }
      });
    }

    // 静的ファイル配信
    let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = join(DIST_DIR, pathname);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return new Response('Not Found', { status: 404 });
    }

    // HTMLファイルにはライブリロードスクリプトを注入
    if (pathname.endsWith('.html')) {
      const html = await file.text();
      const injected = html.replace('</body>', `${liveReloadScript}</body>`);
      return new Response(injected, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response(file);
  }
});

console.log(`🚀 http://localhost:${server.port}`);
console.log(`👀 ${watchDirs.join(', ')} を監視中...`);
