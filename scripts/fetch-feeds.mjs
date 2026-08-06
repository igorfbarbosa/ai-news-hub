import Parser from 'rss-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-News-Hub-Bot/1.0'
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['content:encoded', 'contentEncoded']
    ]
  }
});

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractImageUrl(item) {
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
    return item.mediaContent.$.url;
  }
  if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
    return item.mediaThumbnail.$.url;
  }
  if (item.enclosure && item.enclosure.url && item.enclosure.type?.startsWith('image')) {
    return item.enclosure.url;
  }
  const fullHtml = item.contentEncoded || item.content || item.description || '';
  const imgMatch = fullHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch && imgMatch[1] && !imgMatch[1].includes('feedburner') && !imgMatch[1].includes('analytics')) {
    return imgMatch[1];
  }
  return null;
}

function getReadingTime(text) {
  const words = text ? text.split(/\s+/).length : 0;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}

async function run() {
  console.log('🚀 Iniciando busca de feeds RSS...');
  const feedsPath = path.join(rootDir, 'feeds.json');
  const feedsData = await fs.readFile(feedsPath, 'utf-8');
  const feeds = JSON.parse(feedsData);

  const allArticles = [];

  for (const feedConfig of feeds) {
    try {
      console.log(`📡 Lendo: ${feedConfig.name} (${feedConfig.url})`);
      const feed = await parser.parseURL(feedConfig.url);
      
      let count = 0;
      for (const item of feed.items || []) {
        const rawTitle = item.title ? stripHtml(item.title) : 'Sem título';
        const rawContent = item.contentEncoded || item.content || item.summary || item.description || '';
        const cleanSnippet = stripHtml(rawContent).slice(0, 280);
        
        const pubDateStr = item.isoDate || item.pubDate || new Date().toISOString();
        const dateObj = new Date(pubDateStr);
        const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;

        const imageUrl = extractImageUrl(item);
        const articleLink = item.link || item.guid || '#';

        allArticles.push({
          id: Buffer.from(articleLink).toString('base64').replace(/=/g, '').slice(-20),
          title: rawTitle,
          link: articleLink,
          snippet: cleanSnippet + (cleanSnippet.length >= 280 ? '...' : ''),
          pubDate: validDate.toISOString(),
          timestamp: validDate.getTime(),
          sourceId: feedConfig.id,
          sourceName: feedConfig.name,
          sourceIcon: feedConfig.icon,
          category: feedConfig.category,
          lang: feedConfig.lang,
          imageUrl: imageUrl,
          readingTime: getReadingTime(cleanSnippet)
        });
        count++;
      }
      console.log(`   ✅  ${count} artigos obtidos de ${feedConfig.name}`);
    } catch (err) {
      console.error(`   ❌ Falha ao buscar ${feedConfig.name}:`, err.message);
    }
  }

  // Deduplicar por link ou título similar
  const seenLinks = new Set();
  const uniqueArticles = [];
  for (const article of allArticles) {
    const key = article.link.toLowerCase();
    if (!seenLinks.has(key)) {
      seenLinks.add(key);
      uniqueArticles.push(article);
    }
  }

  // Ordenar por data mais recente
  uniqueArticles.sort((a, b) => b.timestamp - a.timestamp);

  // Manter no máximo 150 artigos
  const finalArticles = uniqueArticles.slice(0, 150);

  const output = {
    updatedAt: new Date().toISOString(),
    totalArticles: finalArticles.length,
    articles: finalArticles
  };

  const dataDir = path.join(rootDir, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  const outputPath = path.join(dataDir, 'news.json');
  
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n🎉 Processamento concluído com sucesso! ${finalArticles.length} artigos salvos em data/news.json`);
}

run().catch((err) => {
  console.error('Fatal error during feed execution:', err);
  process.exit(1);
});
