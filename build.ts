import { readdir, mkdir, rm } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { marked } from 'marked';
import matter from 'gray-matter';

const CONTENT_DIR = './content';
const TEMPLATE_DIR = './templates';
const PUBLIC_DIR = './public';
const DIST_DIR = './dist';

interface PageData {
  title: string;
  date: string;
  content: string;
  slug: string;
}

// テンプレートに値を埋め込む簡易関数
function render(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

async function copyDir(src: string, dest: string) {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await Bun.write(destPath, Bun.file(srcPath));
    }
  }
}

async function build() {
  console.log('🔨 ビルド開始...');

  // 出力ディレクトリをクリーン
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  // テンプレート読み込み
  const template = await Bun.file(join(TEMPLATE_DIR, 'base.html')).text();

  // Markdownファイルを処理
  const files = await readdir(CONTENT_DIR);
  const pages: PageData[] = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const raw = await Bun.file(join(CONTENT_DIR, file)).text();
    const { data, content } = matter(raw);
    const html = await marked(content);
    const slug = parse(file).name;

    const page: PageData = {
      title: data.title ?? slug,
      date: data.date ?? '',
      content: html,
      slug
    };

    const rendered = render(template, {
      title: page.title,
      date: String(page.date),
      content: page.content
    });

    await Bun.write(join(DIST_DIR, `${slug}.html`), rendered);
    pages.push(page);
    console.log(`  ✓ ${slug}.html`);
  }

  // index.html（記事一覧）を生成
  const list = pages
    .map(
      (p) => `<li><a href="./${p.slug}.html">${p.title}</a> (${p.date})</li>`
    )
    .join('\n');

  const index = render(template, {
    title: 'ホーム',
    date: new Date().toISOString().substring(0, 10),
    content: `<ul>${list}</ul>`
  });
  await Bun.write(join(DIST_DIR, 'index.html'), index);
  console.log('  ✓ index.html');

  // public/ をコピー
  try {
    await copyDir(PUBLIC_DIR, DIST_DIR);
    console.log('  ✓ public/ をコピー');
  } catch (error) {
    // public/ が無くてもエラーにしない
  }

  console.log(`✨ ${pages.length}件のページを生成しました`);
}

build().catch(console.error);
