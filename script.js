'use strict';

// 公開用の中継API URLだけを設定します。秘密のAPIキーは中継側の環境変数で管理し、ここへ記載しないでください。
// 例: https://your-project.example.workers.dev/api （末尾の / はどちらでも可）
const API_PROXY_BASE_URL = '';
// "demo" または "api"。apiでも中継APIが未設定なら自動的にdemoへ戻ります。
const DATA_MODE = 'demo';
const DATA_ERROR_MESSAGE = 'データ取得に失敗しました。時間をおいて再度お試しください。';
const PRICE_ERROR_MESSAGE = '価格取得に失敗しました。時間をおいて再度お試しください。';
const NEWS_ERROR_MESSAGE = 'ニュース取得に失敗しました。時間をおいて再度お試しください。';
const STORAGE_KEY = 'stock-alert-memo-v1';
const THEME_KEY = 'stock-alert-theme';
const UPDATE_INTERVAL = 2000;
const API_REFRESH_INTERVAL = 60000;
const API_FEATURES = { marketPrice: true, chart: true, news: true };
const API_ENDPOINTS = { market: 'market', chart: 'chart', news: 'news' };
const DEFAULT_CHART_RANGE = '1m';
const CHART_CACHE_TTL = 5 * 60 * 1000;
const SUMMARY_MIN_NEWS_COUNT = 2;
const SUMMARY_ERROR_MESSAGE = 'ニュース要約を作成できませんでした。\nニュース一覧はそのまま確認できます。\n本欄は投資判断や将来予測を目的としたものではありません。';
const NOTE_KINDS = ['なぜ気になったか', '確認したこと', '次に確認したいこと', '決算', '配当', 'ニュース', 'その他'];
const BACKUP_FORMAT_VERSION = 1;
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMPORT_STOCKS = 500;
const CHART_RANGE_CONFIG = {
  '1d': { label: '1日', interval: '5min', outputsize: 78, demoPoints: 32, demoVolatility: .0018 },
  '1w': { label: '1週間', interval: '1h', outputsize: 35, demoPoints: 28, demoVolatility: .0032 },
  '1m': { label: '1か月', interval: '1day', outputsize: 30, demoPoints: 30, demoVolatility: .006 }
};
const chartApiCache = new Map();

const assetTypeSettings = {
  '個別株': { updateMode: 'realtime' },
  '指数': { updateMode: 'realtime' },
  'ETF': { updateMode: 'realtime' },
  'その他': { updateMode: 'realtime' },
  // 将来の投資信託モード用。候補データはまだ登録せず、更新周期だけ定義しておきます。
  '投資信託': { updateMode: 'daily' }
};

const stockCatalog = [
  { name: 'S&P500', symbol: '^GSPC', aliases: ['SP500', 'S&P 500'], type: '指数', region: '米国', market: '米国指数', price: 6173.07, currency: 'USD', change: 0.52 },
  { name: 'NASDAQ100', symbol: '^NDX', aliases: ['NASDAQ 100', 'ナスダック100'], type: '指数', region: '米国', market: '米国指数', price: 22447.29, currency: 'USD', change: 0.67 },
  { name: 'NYダウ', symbol: '^DJI', aliases: ['ダウ', 'DOW'], type: '指数', region: '米国', market: '米国指数', price: 43819.27, currency: 'USD', change: -0.14 },
  { name: '日経平均', symbol: '^N225', aliases: ['日経225', 'NIKKEI'], type: '指数', region: '日本', market: '日本指数', price: 40261.15, currency: 'JPY', change: 0.38 },
  { name: 'TOPIX', symbol: '^TOPX', aliases: ['東証株価指数'], type: '指数', region: '日本', market: '日本指数', price: 2897.14, currency: 'JPY', change: 0.21 },
  { name: 'Vanguard S&P 500 ETF', symbol: 'VOO', aliases: ['Vanguard'], type: 'ETF', region: '米国', market: 'NYSE Arca', price: 567.88, currency: 'USD', change: 0.49 },
  { name: 'SPDR S&P 500 ETF Trust', symbol: 'SPY', aliases: ['SPDR'], type: 'ETF', region: '米国', market: 'NYSE Arca', price: 614.91, currency: 'USD', change: 0.51 },
  { name: 'Invesco QQQ Trust', symbol: 'QQQ', aliases: ['Invesco'], type: 'ETF', region: '米国', market: 'NASDAQ', price: 548.72, currency: 'USD', change: 0.62 },
  { name: 'Apple', symbol: 'AAPL', type: '個別株', region: '米国', market: 'NASDAQ', price: 211.18, currency: 'USD', change: 1.42 },
  { name: 'Microsoft', symbol: 'MSFT', type: '個別株', region: '米国', market: 'NASDAQ', price: 485.61, currency: 'USD', change: -1.16 },
  { name: 'NVIDIA', symbol: 'NVDA', type: '個別株', region: '米国', market: 'NASDAQ', price: 157.75, currency: 'USD', change: 2.28 },
  { name: 'Amazon.com', symbol: 'AMZN', type: '個別株', region: '米国', market: 'NASDAQ', price: 219.94, currency: 'USD', change: 0.72 },
  { name: 'Alphabet', symbol: 'GOOGL', type: '個別株', region: '米国', market: 'NASDAQ', price: 176.62, currency: 'USD', change: -0.35 },
  { name: 'トヨタ自動車', symbol: '7203.T', aliases: ['7203', 'トヨタ'], type: '個別株', region: '日本', market: '東証', price: 2587.5, currency: 'JPY', change: -0.86 },
  { name: '任天堂', symbol: '7974.T', aliases: ['7974'], type: '個別株', region: '日本', market: '東証', price: 13240, currency: 'JPY', change: 2.13 },
  { name: 'ソニーグループ', symbol: '6758.T', aliases: ['6758', 'ソニー'], type: '個別株', region: '日本', market: '東証', price: 3812, currency: 'JPY', change: 0.64 },
  { name: '三菱UFJフィナンシャル・グループ', symbol: '8306.T', aliases: ['8306', '三菱UFJ'], type: '個別株', region: '日本', market: '東証', price: 1987, currency: 'JPY', change: -0.42 },
  { name: 'ファーストリテイリング', symbol: '9983.T', aliases: ['9983'], type: '個別株', region: '日本', market: '東証', price: 50420, currency: 'JPY', change: 1.08 }
];

// 将来は search() と getBySymbol() の中身をAPI呼び出しへ差し替えられます。
const stockDataProvider = {
  async search(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return stockCatalog.filter(stock => [stock.symbol, stock.name, ...(stock.aliases || [])].some(value => value.toLowerCase().includes(normalized))).slice(0, 6);
  },
  getBySymbol(value) {
    const normalized = value.trim().toLowerCase();
    return stockCatalog.find(stock => [stock.symbol, stock.name, ...(stock.aliases || [])].some(candidate => candidate.toLowerCase() === normalized));
  }
};

function generateDemoChartData(symbol, range = DEFAULT_CHART_RANGE) {
  const source = stocks?.find(item => item.symbol === symbol) || stockDataProvider.getBySymbol(symbol);
  if (!source) throw new Error(`Unknown demo chart symbol: ${symbol}`);
  const config = CHART_RANGE_CONFIG[range] || CHART_RANGE_CONFIG[DEFAULT_CHART_RANGE];
  const points = [];
  let value = source.price * (1 - source.change / 100 * .25);
  for (let index = 0; index < config.demoPoints; index++) {
    value *= 1 + (Math.random() - .48) * config.demoVolatility;
    points.push(value);
  }
  points[points.length - 1] = source.price;
  return { symbol, range, source: 'demo', points, fetchedAt: new Date().toISOString(), fallbackReason: null };
}

function getApiProxyBaseUrl() {
  return API_PROXY_BASE_URL.trim().replace(/\/+$/, '');
}

function unwrapApiPayload(payload) {
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
}

async function requestApiProxy(endpoint, params = {}) {
  const baseUrl = getApiProxyBaseUrl();
  if (!baseUrl) throw new Error('API proxy is not configured.');
  const normalizedBase = /^https?:\/\//i.test(baseUrl) ? baseUrl : new URL(baseUrl, window.location.origin).toString().replace(/\/+$/, '');
  const url = new URL(`${normalizedBase}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' }, credentials: 'omit' });
  if (!response.ok) throw new Error(`API proxy HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error || payload?.status === 'error') throw new Error(payload.message || payload.error || 'API proxy error');
  return unwrapApiPayload(payload);
}

function findStockSource(symbol) {
  return stocks?.find(item => item.symbol === symbol) || stockDataProvider.getBySymbol(symbol);
}

async function fetchRealMarketData(symbol) {
  const source = findStockSource(symbol);
  if (!source) throw new Error(`Unknown API symbol: ${symbol}`);
  const payload = await requestApiProxy(API_ENDPOINTS.market, { symbol });
  const price = Number(payload?.price);
  const change = Number(payload?.change ?? payload?.percentChange ?? source.change);
  if (!Number.isFinite(price)) throw new Error('Market API returned an invalid price.');
  return {
    symbol,
    price,
    change: Number.isFinite(change) ? change : 0,
    currency: payload?.currency || source.currency,
    dataSource: 'api',
    provider: payload?.provider || 'API',
    fetchedAt: payload?.fetchedAt || new Date().toISOString()
  };
}

async function fetchRealChartData(symbol, range = DEFAULT_CHART_RANGE) {
  const config = CHART_RANGE_CONFIG[range];
  if (!config) throw new Error(`Unsupported chart range: ${range}`);
  const cacheKey = `${symbol}:${range}`;
  const cached = chartApiCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CHART_CACHE_TTL) return cached.data;

  const payload = await requestApiProxy(API_ENDPOINTS.chart, {
    symbol,
    range,
    interval: config.interval,
    outputsize: config.outputsize
  });
  const rawPoints = payload?.points || payload?.values || [];
  const points = rawPoints.map(item => Number(typeof item === 'object' ? item.close ?? item.value : item)).filter(Number.isFinite);
  if (points.length < 2) throw new Error('Chart API returned insufficient data.');
  const data = {
    symbol,
    range,
    source: 'api',
    provider: payload?.provider || 'API',
    points,
    fetchedAt: payload?.fetchedAt || new Date().toISOString(),
    fallbackReason: null
  };
  chartApiCache.set(cacheKey, { cachedAt: Date.now(), data });
  return data;
}

function formatNewsTime(value) {
  if (!value) return '';
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

async function fetchRealNewsData(symbol) {
  const payload = await requestApiProxy(API_ENDPOINTS.news, { symbol });
  const rawItems = Array.isArray(payload) ? payload : payload?.items || payload?.articles || payload?.news || [];
  return rawItems.map(item => ({
    symbol,
    title: String(item?.title || item?.headline || '').trim(),
    source: typeof item?.source === 'object' ? item.source.name : item?.source || item?.provider || '配信元不明',
    time: item?.time || formatNewsTime(item?.publishedAt || item?.datetime || item?.date),
    category: item?.category || '関連情報',
    url: item?.url || item?.link || '',
    dataSource: 'api',
    isSample: false
  })).filter(item => item.title && isHttpUrl(item.url));
}

const demoNewsCatalog = {
  US_STOCK: [
    { title: '四半期の事業概況を発表、主要部門の売上高を開示', source: 'Sample Business', time: '18分前', category: '決算', url: 'https://example.com/news/us-earnings' },
    { title: '新製品と対応サービスの概要を公開', source: 'Sample Wire', time: '1時間前', category: '製品発表', url: 'https://example.com/news/us-product' },
    { title: '米国主要株価指数の終値と業種別の動きを公表', source: 'Market Sample', time: '3時間前', category: '市場全体', url: 'https://example.com/news/us-market' }
  ],
  JP_STOCK: [
    { title: '次回の決算発表日を公式サイトで案内', source: 'サンプル通信', time: '24分前', category: '決算', url: 'https://example.com/news/jp-results' },
    { title: '月次の生産・販売実績を公開', source: '参考経済情報', time: '2時間前', category: '企業発表', url: 'https://example.com/news/jp-production' },
    { title: '国内株式市場の業種別騰落率を公表', source: 'Market Sample', time: '4時間前', category: '市場全体', url: 'https://example.com/news/jp-market' }
  ],
  US_INDEX: [
    { title: '主要指数の構成銘柄と当日の値動きを集計', source: 'Index Sample', time: '20分前', category: '指数', url: 'https://example.com/news/us-index' },
    { title: '米国市場のセクター別推移を公表', source: 'Market Sample', time: '1時間前', category: '市場全体', url: 'https://example.com/news/us-sectors' },
    { title: '雇用統計の公表値と前月値を整理', source: 'Sample Economy', time: '5時間前', category: '経済指標', url: 'https://example.com/news/us-economy' }
  ],
  JP_INDEX: [
    { title: '国内主要指数の終値と構成銘柄の動きを集計', source: 'Index Sample', time: '25分前', category: '指数', url: 'https://example.com/news/jp-index' },
    { title: '東京市場の売買概況を公表', source: '参考経済情報', time: '2時間前', category: '市場全体', url: 'https://example.com/news/jp-overview' },
    { title: '国内経済指標の最新公表値を整理', source: 'Sample Economy', time: '6時間前', category: '経済指標', url: 'https://example.com/news/jp-economy' }
  ],
  US_ETF: [
    { title: 'ETFの純資産総額と基準価額を更新', source: 'ETF Sample', time: '16分前', category: 'ETF', url: 'https://example.com/news/us-etf' },
    { title: '連動対象指数の当日の値動きを集計', source: 'Index Sample', time: '1時間前', category: '指数', url: 'https://example.com/news/us-etf-index' },
    { title: '米国市場の出来高と業種別推移を公表', source: 'Market Sample', time: '3時間前', category: '市場全体', url: 'https://example.com/news/us-etf-market' }
  ]
};

function generateDemoNewsData(symbol) {
  const source = stocks?.find(item => item.symbol === symbol) || stockDataProvider.getBySymbol(symbol);
  if (!source) throw new Error(`Unknown demo news symbol: ${symbol}`);
  const catalogKey = source.type === 'ETF' ? 'US_ETF' : source.type === '指数' ? (source.region === '日本' ? 'JP_INDEX' : 'US_INDEX') : (source.region === '日本' ? 'JP_STOCK' : 'US_STOCK');
  return demoNewsCatalog[catalogKey].map(item => ({ ...item, symbol, dataSource: 'demo', isSample: true }));
}

// 画面側はこの共通インターフェースだけを利用します。API提供元の違いは中継API側で吸収します。
const dataProviders = {
  demo: {
    async fetchMarketData(symbol) {
      const source = stocks?.find(item => item.symbol === symbol) || stockDataProvider.getBySymbol(symbol);
      if (!source) throw new Error(`Unknown demo symbol: ${symbol}`);
      const volatility = source.currency === 'JPY' ? .0018 : .0014;
      return {
        symbol: source.symbol,
        price: Math.max(.01, source.price * (1 + (Math.random() - .5) * volatility)),
        change: source.change,
        currency: source.currency,
        dataSource: 'demo',
        fetchedAt: new Date().toISOString()
      };
    },
    async fetchChartData(symbol, range) {
      return generateDemoChartData(symbol, range);
    },
    async fetchNewsData(symbol) {
      return generateDemoNewsData(symbol);
    }
  },
  api: {
    fetchMarketData: fetchRealMarketData,
    fetchChartData: fetchRealChartData,
    fetchNewsData: fetchRealNewsData
  }
};

function getEffectiveDataMode() {
  return DATA_MODE === 'api' && getApiProxyBaseUrl() ? 'api' : 'demo';
}

function usesApiPrice(stock) {
  return getEffectiveDataMode() === 'api' && stock?.dataSource === 'api';
}

async function fetchMarketData(symbol) {
  const providerMode = getEffectiveDataMode() === 'api' && API_FEATURES.marketPrice ? 'api' : 'demo';
  if (providerMode === 'demo') return dataProviders.demo.fetchMarketData(symbol);
  try {
    return await dataProviders.api.fetchMarketData(symbol);
  } catch (error) {
    console.warn(`Market API fallback for ${symbol}:`, error);
    const fallback = await dataProviders.demo.fetchMarketData(symbol);
    fallback.dataSource = 'demo-fallback';
    fallback.fallbackReason = error.message || 'Market API error';
    return fallback;
  }
}

async function fetchChartData(symbol, range = DEFAULT_CHART_RANGE) {
  const providerMode = getEffectiveDataMode() === 'api' && API_FEATURES.chart ? 'api' : 'demo';
  if (providerMode === 'demo') return dataProviders.demo.fetchChartData(symbol, range);
  try {
    return await dataProviders.api.fetchChartData(symbol, range);
  } catch (error) {
    console.warn(`Chart API fallback for ${symbol} (${range}):`, error);
    const fallback = await dataProviders.demo.fetchChartData(symbol, range);
    fallback.source = 'demo-fallback';
    fallback.fallbackReason = error.message || 'Chart API error';
    return fallback;
  }
}

async function fetchNewsData(symbol) {
  const providerMode = getEffectiveDataMode() === 'api' && API_FEATURES.news ? 'api' : 'demo';
  if (providerMode === 'demo') return dataProviders.demo.fetchNewsData(symbol);
  try {
    const items = await dataProviders.api.fetchNewsData(symbol);
    if (!items.length) throw new Error('News API returned no articles.');
    return items;
  } catch (error) {
    console.warn(`News API fallback for ${symbol}:`, error);
    return dataProviders.demo.fetchNewsData(symbol).map(item => ({ ...item, dataSource: 'demo-fallback', fallbackReason: error.message || 'News API error' }));
  }
}

const SUMMARY_TOPIC_RULES = [
  { label: '決算・業績', pattern: /決算|業績|四半期|売上高|利益|earnings|revenue/i },
  { label: '製品・サービス', pattern: /製品|サービス|発売|新機能|提供開始|product|service/i },
  { label: '経済指標', pattern: /経済指標|雇用|物価|GDP|金利|景気|economy|economic/i },
  { label: 'ETF', pattern: /ETF|純資産|基準価額/i },
  { label: '市場全体・指数', pattern: /市場全体|主要指数|株価指数|指数|構成銘柄|セクター|業種別|出来高|売買概況|市場|index|market/i },
  { label: '企業発表・事業動向', pattern: /企業発表|生産|販売実績|月次|事業概況|会社発表/i }
];

function normalizeNewsTitle(title = '') {
  return String(title).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function deduplicateNewsItems(newsItems) {
  return newsItems.reduce((uniqueItems, item) => {
    const normalizedTitle = normalizeNewsTitle(item?.title);
    const duplicate = uniqueItems.some(existing => {
      const existingTitle = normalizeNewsTitle(existing?.title);
      if (item?.url && existing?.url && item.url === existing.url) return true;
      if (!normalizedTitle || !existingTitle) return false;
      return normalizedTitle === existingTitle || (Math.min(normalizedTitle.length, existingTitle.length) >= 12 && (normalizedTitle.includes(existingTitle) || existingTitle.includes(normalizedTitle)));
    });
    if (!duplicate) uniqueItems.push(item);
    return uniqueItems;
  }, []);
}

function detectNewsTopic(item) {
  const sourceText = `${item?.category || ''} ${item?.title || ''}`;
  return SUMMARY_TOPIC_RULES.find(rule => rule.pattern.test(sourceText))?.label || item?.category || '関連情報';
}

// 現在はルールベース。将来はこの関数の中身をAI API呼び出しへ差し替えられます。
function generateAISummary(newsItems) {
  const items = Array.isArray(newsItems) ? newsItems.filter(item => item?.title?.trim()) : [];
  const uniqueItems = deduplicateNewsItems(items);
  if (uniqueItems.length < SUMMARY_MIN_NEWS_COUNT) {
    return [
      '十分なニュースがありません。',
      '要約には2件以上のニュース見出しが必要です。',
      'ニュース一覧はそのまま確認できます。',
      '本欄は投資判断や将来予測を目的としたものではありません。'
    ].join('\n');
  }

  const topicCounts = uniqueItems.reduce((counts, item) => {
    const topic = detectNewsTopic(item);
    counts.set(topic, (counts.get(topic) || 0) + 1);
    return counts;
  }, new Map());
  const topics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const [mainTopic, mainCount] = topics[0];
  const openingTopicCount = mainCount >= 2 ? 1 : Math.min(2, topics.length);
  const openingTopics = topics.slice(0, openingTopicCount).map(([topic]) => topic);
  const otherTopics = topics.slice(openingTopicCount, openingTopicCount + 3).map(([topic]) => topic);
  const lines = [
    mainCount >= 2
      ? `本日のニュースでは、${mainTopic}に関する記事が複数見られます。`
      : `本日のニュースでは、${openingTopics.join('、')}に関する記事が見られます。`,
    otherTopics.length
      ? `あわせて、${otherTopics.join('、')}についても取り上げられています。`
      : '複数の見出しに共通するテーマをまとめて整理しています。',
    uniqueItems.length < items.length
      ? '同じ内容を扱う重複・類似見出しはまとめています。'
      : '見出しごとの種類と共通点を整理しています。',
    'これはニュース見出しの事実整理であり、投資判断や将来予測を目的としたものではありません。'
  ];
  return lines.join('\n');
}

const initialStocks = [
  { id: crypto.randomUUID(), name: 'Apple', symbol: 'AAPL', type: '個別株', region: '米国', market: 'NASDAQ', updateMode: 'realtime', price: 211.18, currency: 'USD', change: 1.42, direction: 'above', target: 215, percent: 3, notes: [{ id: crypto.randomUUID(), date: todayDate(), kind: '確認したいこと', text: '次回の決算発表日と発表資料を確認する。', createdAt: Date.now() }] },
  { id: crypto.randomUUID(), name: 'トヨタ自動車', symbol: '7203.T', type: '個別株', region: '日本', market: '東証', updateMode: 'realtime', price: 2587.5, currency: 'JPY', change: -0.86, direction: 'below', target: 2500, percent: 2, notes: [{ id: crypto.randomUUID(), date: todayDate(), kind: 'なぜ気になったか', text: '月次の生産・販売実績を継続して整理したい。', createdAt: Date.now() - 1 }] }
];

function normalizeSymbol(value = '') {
  return String(value).trim().toUpperCase();
}

function getAssetClass(type) {
  return { '個別株': 'stock', ETF: 'etf', '指数': 'index', 'その他': 'other' }[type] || 'other';
}

function normalizeStoredNote(note) {
  if (!note || typeof note !== 'object') return null;
  const text = String(note.text ?? note.memo ?? '').trim();
  if (!text) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(note.date || '')) ? String(note.date) : todayDate();
  return {
    id: note.id || crypto.randomUUID(),
    date,
    kind: typeof note.kind === 'string' && note.kind.trim() ? note.kind.trim().slice(0, 40) : 'その他',
    text: text.slice(0, 500),
    createdAt: Number.isFinite(Number(note.createdAt)) ? Number(note.createdAt) : Date.now()
  };
}

function normalizeStoredStock(item) {
  const symbol = normalizeSymbol(item?.symbol);
  const catalogItem = stockDataProvider.getBySymbol(symbol);
  const type = assetTypeSettings[item?.type] ? item.type : catalogItem?.type || '個別株';
  const region = item?.region || catalogItem?.region || (item?.currency === 'JPY' || /\.T$/.test(symbol) || /^\d{4,5}$/.test(symbol) ? '日本' : '米国');
  const notes = (Array.isArray(item?.notes) ? item.notes : []).map(normalizeStoredNote).filter(Boolean).slice(0, 1000);
  const memo = typeof item?.memo === 'string' ? item.memo : '';
  if (!notes.length && memo.trim()) notes.push({ id: crypto.randomUUID(), date: todayDate(), kind: 'その他', text: memo.trim().slice(0, 500), createdAt: Date.now() });
  const tags = Array.isArray(item?.tags)
    ? item.tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim().slice(0, 24)).filter((tag, index, values) => values.findIndex(value => value.toLowerCase() === tag.toLowerCase()) === index).slice(0, 12)
    : [];
  return {
    ...item,
    id: item?.id || crypto.randomUUID(),
    symbol,
    name: (typeof item?.name === 'string' ? item.name.trim().slice(0, 80) : '') || catalogItem?.name || symbol,
    type,
    assetClass: item?.assetClass || getAssetClass(type),
    region,
    market: item?.market || catalogItem?.market || (region === '日本' ? '東証（仮）' : '米国市場（仮）'),
    price: Number.isFinite(Number(item?.price)) ? Number(item.price) : region === '日本' ? 1850 : 100,
    change: Number.isFinite(Number(item?.change)) ? Number(item.change) : 0,
    currency: item?.currency || (region === '日本' ? 'JPY' : 'USD'),
    memo: memo.slice(0, 500),
    watchReason: typeof item?.watchReason === 'string' ? item.watchReason.slice(0, 300) : '',
    notes,
    favorite: Boolean(item?.favorite),
    tags,
    updateMode: item?.updateMode || assetTypeSettings[type]?.updateMode || 'realtime'
  };
}

let stocks = loadStocks();
let selectedSuggestion = null;
let activeSuggestionIndex = -1;
const priceHistories = new Map();
const chartRanges = new Map();
const runtimeCardData = new Map();
const noteFilters = new Map();
const form = document.querySelector('#stockForm');
const symbolInput = document.querySelector('#symbolInput');
const nameInput = document.querySelector('#nameInput');
const suggestions = document.querySelector('#suggestions');
const watchlist = document.querySelector('#watchlist');
const emptyState = document.querySelector('#emptyState');
const jsonImportInput = document.querySelector('#jsonImportInput');
const dataManagementStatus = document.querySelector('#dataManagementStatus');

function loadStocks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return (Array.isArray(saved) ? saved : initialStocks).map(normalizeStoredStock);
  } catch { return initialStocks.map(normalizeStoredStock); }
}

function saveStocks() { localStorage.setItem(STORAGE_KEY, JSON.stringify(stocks)); }

function backupDateStamp() { return todayDate().replace(/-/g, ''); }

function createBackupPayload(stockList, theme) {
  return {
    app: 'My Market AI',
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: { theme: theme === 'dark' ? 'dark' : 'light' },
    watchlist: JSON.parse(JSON.stringify(stockList))
  };
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function createNotesCsv(stockList) {
  const headers = ['symbol', 'name', 'type', 'favorite', 'tags', 'watchReason', 'noteDate', 'noteCategory', 'noteText'];
  const rows = [headers.map(csvCell).join(',')];
  stockList.forEach(stock => {
    const notes = Array.isArray(stock.notes) && stock.notes.length ? stock.notes : [null];
    notes.forEach(note => rows.push([
      stock.symbol, stock.name, stock.type, Boolean(stock.favorite), (stock.tags || []).join(' | '), stock.watchReason || '',
      note?.date || '', note?.kind || '', note?.text || ''
    ].map(csvCell).join(',')));
  });
  return `\uFEFF${rows.join('\r\n')}`;
}

function parseBackupText(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('JSONファイルの形式が正しくありません。'); }
  const rawStocks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.watchlist) ? parsed.watchlist : Array.isArray(parsed?.stocks) ? parsed.stocks : Array.isArray(parsed?.data) ? parsed.data : null;
  if (!rawStocks) throw new Error('ウォッチリストデータが見つかりません。');
  if (rawStocks.length > MAX_IMPORT_STOCKS) throw new Error(`復元できる登録対象は${MAX_IMPORT_STOCKS}件までです。`);
  const symbols = new Set();
  const importedStocks = rawStocks.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('登録対象のデータ形式が正しくありません。');
    const symbol = normalizeSymbol(item.symbol);
    if (!symbol || !/^[A-Z0-9^.\-:]+$/.test(symbol)) throw new Error('不正な銘柄コードが含まれています。');
    if (symbols.has(symbol)) throw new Error(`銘柄コード ${symbol} が重複しています。`);
    symbols.add(symbol);
    return normalizeStoredStock({ ...item, symbol });
  });
  const settings = parsed && !Array.isArray(parsed) && parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings) ? parsed.settings : {};
  return { stocks: importedStocks, settings };
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setDataManagementStatus(message, isError = false) {
  dataManagementStatus.textContent = message;
  dataManagementStatus.classList.toggle('error', isError);
}

function exportJsonBackup() {
  try {
    const payload = createBackupPayload(stocks, localStorage.getItem(THEME_KEY) || 'light');
    triggerDownload(JSON.stringify(payload, null, 2), `my-market-ai-backup-${backupDateStamp()}.json`, 'application/json;charset=utf-8');
    setDataManagementStatus('JSONバックアップを保存しました。');
  } catch (error) {
    console.error('JSON export failed:', error); setDataManagementStatus('JSONバックアップを作成できませんでした。', true);
  }
}

function exportNotesCsv() {
  try {
    triggerDownload(createNotesCsv(stocks), `my-market-ai-notes-${backupDateStamp()}.csv`, 'text/csv;charset=utf-8');
    setDataManagementStatus('CSVを保存しました。');
  } catch (error) {
    console.error('CSV export failed:', error); setDataManagementStatus('CSVを作成できませんでした。', true);
  }
}

async function importJsonBackup(file) {
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_FILE_SIZE) throw new Error('ファイルサイズは5MB以下にしてください。');
    const imported = parseBackupText(await file.text());
    const accepted = confirm(`現在の保存データを上書きし、${imported.stocks.length}件を復元します。続行しますか？`);
    if (!accepted) { setDataManagementStatus('復元をキャンセルしました。'); return; }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imported.stocks));
    stocks = imported.stocks;
    priceHistories.clear(); chartRanges.clear(); runtimeCardData.clear(); noteFilters.clear();
    if (imported.settings.theme === 'dark' || imported.settings.theme === 'light') {
      localStorage.setItem(THEME_KEY, imported.settings.theme); applyTheme(imported.settings.theme);
    }
    render();
    await refreshAllData(); render();
    setDataManagementStatus(`${stocks.length}件のデータを復元しました。`);
  } catch (error) {
    setDataManagementStatus(error.message || 'JSONを復元できませんでした。', true);
  } finally {
    jsonImportInput.value = '';
  }
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatPrice(stock, value = stock.price) {
  return new Intl.NumberFormat(stock.currency === 'JPY' ? 'ja-JP' : 'en-US', {
    style: 'currency', currency: stock.currency, minimumFractionDigits: stock.currency === 'JPY' ? 0 : 2,
    maximumFractionDigits: stock.currency === 'JPY' ? 0 : 2
  }).format(value);
}

function evaluateAlert(stock) {
  const hasTarget = stock.target !== '' && stock.target != null;
  const hasPercent = stock.percent !== '' && stock.percent != null;
  const priceHit = hasTarget && (stock.direction === 'above' ? stock.price >= Number(stock.target) : stock.price <= Number(stock.target));
  const percentHit = hasPercent && Math.abs(stock.change) >= Number(stock.percent);
  return { priceHit, percentHit, active: priceHit || percentHit };
}

function getOrCreateChartHistory(stock) {
  if (priceHistories.has(stock.id)) return priceHistories.get(stock.id);
  const range = chartRanges.get(stock.id) || DEFAULT_CHART_RANGE;
  const chartData = generateDemoChartData(stock.symbol, range);
  priceHistories.set(stock.id, chartData);
  return chartData;
}

async function refreshStockData(stock) {
  const state = runtimeCardData.get(stock.id) || { news: [], error: null, newsError: null, lastMarketAttempt: 0 };

  try {
    const range = chartRanges.get(stock.id) || DEFAULT_CHART_RANGE;
    chartRanges.set(stock.id, range);
    const chartData = await fetchChartData(stock.symbol, range);
    priceHistories.set(stock.id, chartData);
  } catch (error) {
    console.error(`Chart refresh failed for ${stock.symbol}:`, error);
    state.error = DATA_ERROR_MESSAGE;
  }

  try {
    const newsData = await fetchNewsData(stock.symbol);
    state.news = newsData;
    state.newsError = null;
  } catch (error) {
    console.error(`News refresh failed for ${stock.symbol}:`, error);
    state.news = [];
    state.newsError = NEWS_ERROR_MESSAGE;
  }

  state.lastMarketAttempt = Date.now();
  try {
    const marketData = await fetchMarketData(stock.symbol);
    Object.assign(stock, marketData);
    state.error = null;
  } catch (error) {
    console.error(`Price refresh failed for ${stock.symbol}:`, error);
    state.error = PRICE_ERROR_MESSAGE;
  }
  runtimeCardData.set(stock.id, state);
}

async function refreshAllData() {
  await Promise.all(stocks.map(refreshStockData));
  saveStocks();
}

function render() {
  watchlist.innerHTML = '';
  const template = document.querySelector('#stockCardTemplate');

  stocks.forEach(stock => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector('.stock-card');
    const status = evaluateAlert(stock);
    if (status.active) card.classList.add('triggered');
    card.dataset.id = stock.id;
    updateFavoriteUI(card, stock);
    const dataState = runtimeCardData.get(stock.id);
    const errorBox = node.querySelector('.data-error');
    if (dataState?.error) { errorBox.textContent = dataState.error; errorBox.hidden = false; }
    node.querySelector('.stock-avatar').textContent = stock.symbol.charAt(0);
    node.querySelector('.stock-identity h3').textContent = stock.name;
    const meta = node.querySelector('.stock-meta');
    meta.textContent = `${stock.symbol} · ${stock.market} `;
    const badge = document.createElement('span'); badge.className = 'asset-badge'; badge.textContent = `${stock.type} / ${stock.region}`; meta.append(badge);
    renderJournal(card, stock);
    updatePriceElements(node, stock);
    renderConditions(node, stock, status);
    renderNews(stock.symbol, dataState?.news || [], node, dataState?.newsError);
    renderNotes(card, stock);
    node.querySelectorAll('.chart-range-button').forEach(button => button.addEventListener('click', () => changeChartRange(stock.id, button.dataset.range)));
    const noteForm = node.querySelector('.note-form');
    noteForm.querySelector('.note-date').value = todayDate();
    noteForm.addEventListener('submit', event => addNote(event, stock.id));
    node.querySelector('.favorite-button').addEventListener('click', () => toggleFavorite(stock.id, card));
    node.querySelector('.remove-button').setAttribute('aria-label', `${stock.name}を削除`);
    node.querySelector('.remove-button').addEventListener('click', () => removeStock(stock.id, stock.name));
    watchlist.append(node);
  });

  emptyState.hidden = stocks.length > 0;
  document.querySelector('#stockCount').textContent = stocks.length;
  document.querySelector('#noteCount').textContent = stocks.reduce((total, stock) => total + (stock.notes?.length || 0), 0);
  updateTimestamp();
  requestAnimationFrame(renderAllCharts);
}

function updateFavoriteUI(card, stock) {
  card.classList.toggle('favorite', stock.favorite);
  const button = card.querySelector('.favorite-button');
  button.textContent = stock.favorite ? '★' : '☆';
  button.classList.toggle('active', stock.favorite);
  button.setAttribute('aria-pressed', String(stock.favorite));
  button.setAttribute('aria-label', `${stock.name}を${stock.favorite ? 'お気に入りから外す' : 'お気に入りに追加'}`);
}

function toggleFavorite(stockId, card) {
  const stock = stocks.find(item => item.id === stockId); if (!stock) return;
  stock.favorite = !stock.favorite;
  saveStocks(); updateFavoriteUI(card, stock);
}

function updateJournalSummary(scope, stock) {
  const parts = [];
  if (stock.watchReason.trim()) parts.push('理由あり');
  if (stock.tags.length) parts.push(`タグ${stock.tags.length}件`);
  scope.querySelector('.journal-summary').textContent = parts.join('・') || '未登録';
}

function renderTagElements(scope, stock) {
  const preview = scope.querySelector('.stock-tags-preview');
  const list = scope.querySelector('.tag-list');
  preview.innerHTML = ''; list.innerHTML = '';
  stock.tags.slice(0, 3).forEach(tag => {
    const chip = document.createElement('span'); chip.className = 'preview-tag'; chip.textContent = `#${tag}`; preview.append(chip);
  });
  if (stock.tags.length > 3) {
    const more = document.createElement('span'); more.className = 'preview-tag'; more.textContent = `+${stock.tags.length - 3}`; preview.append(more);
  }
  if (!stock.tags.length) {
    const empty = document.createElement('span'); empty.className = 'tag-empty'; empty.textContent = 'タグはまだありません。'; list.append(empty); return;
  }
  stock.tags.forEach(tag => {
    const chip = document.createElement('span'); chip.className = 'tag-chip';
    const label = document.createElement('span'); label.textContent = `#${tag}`;
    const remove = document.createElement('button'); remove.className = 'tag-remove'; remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `タグ「${tag}」を削除`);
    remove.addEventListener('click', () => removeTag(stock.id, tag, scope));
    chip.append(label, remove); list.append(chip);
  });
}

function renderJournal(scope, stock) {
  const reason = scope.querySelector('.watch-reason');
  const message = scope.querySelector('.journal-message');
  reason.value = stock.watchReason;
  updateJournalSummary(scope, stock); renderTagElements(scope, stock);
  scope.querySelector('.watch-reason-save').addEventListener('click', () => {
    stock.watchReason = reason.value.trim(); saveStocks(); updateJournalSummary(scope, stock); message.textContent = 'ウォッチ理由を保存しました。';
  });
  scope.querySelector('.tag-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = event.currentTarget.querySelector('.tag-input');
    const tag = input.value.trim().replace(/^#+/, '').trim();
    if (!tag) { message.textContent = 'タグを入力してください。'; return; }
    if (stock.tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) { message.textContent = '同じタグは登録済みです。'; return; }
    if (stock.tags.length >= 12) { message.textContent = 'タグは12件まで登録できます。'; return; }
    stock.tags.push(tag); saveStocks(); input.value = ''; renderTagElements(scope, stock); updateJournalSummary(scope, stock); message.textContent = `#${tag} を追加しました。`;
  });
}

function removeTag(stockId, tag, scope) {
  const stock = stocks.find(item => item.id === stockId); if (!stock) return;
  stock.tags = stock.tags.filter(item => item !== tag); saveStocks(); renderTagElements(scope, stock); updateJournalSummary(scope, stock); scope.querySelector('.journal-message').textContent = `#${tag} を削除しました。`;
}

function updatePriceElements(scope, stock) {
  scope.querySelector('.currency').textContent = `(${stock.currency})`;
  const source = scope.querySelector('.price-source');
  source.textContent = stock.dataSource === 'api' ? String(stock.provider || 'API').toUpperCase() : stock.dataSource === 'demo-fallback' ? 'SAMPLE FALLBACK' : 'SAMPLE';
  source.classList.toggle('api', stock.dataSource === 'api');
  scope.querySelector('.current-price').textContent = formatPrice(stock);
  const change = scope.querySelector('.change-pill');
  change.classList.remove('up', 'down');
  change.classList.add(stock.change >= 0 ? 'up' : 'down');
  change.textContent = `${stock.change >= 0 ? '▲' : '▼'} ${Math.abs(stock.change).toFixed(2)}%`;
}

function renderConditions(scope, stock, status) {
  const alertStatus = scope.querySelector('.alert-status');
  alertStatus.textContent = status.active ? '条件に一致' : '監視中';
  alertStatus.classList.toggle('active', status.active);
  const conditions = scope.querySelector('.conditions');
  if (stock.target !== '' && stock.target != null) addCondition(conditions, `${formatPrice(stock, Number(stock.target))} を${stock.direction === 'above' ? '上回る' : '下回る'}${status.priceHit ? ' ✓' : ''}`);
  if (stock.percent !== '' && stock.percent != null) addCondition(conditions, `前日比 ±${Number(stock.percent).toFixed(1)}% 以上${status.percentHit ? ' ✓' : ''}`);
  if (!conditions.children.length) addCondition(conditions, '条件未設定');
}

function addCondition(container, text) {
  const tag = document.createElement('span'); tag.className = 'condition'; tag.textContent = text; container.append(tag);
}

function isSampleNewsItem(item) {
  if (item?.isSample || item?.dataSource === 'demo' || item?.dataSource === 'demo-fallback') return true;
  try { return new URL(item?.url).hostname.toLowerCase() === 'example.com'; } catch { return true; }
}

function renderNews(symbol, newsData, scope, newsError = null) {
  const stock = stocks.find(item => item.symbol === symbol);
  if (!stock) return;
  const items = Array.isArray(newsData) ? newsData : [];
  const list = scope.querySelector('.news-list');
  items.forEach(item => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'news-link'; link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = item.title;
    const meta = document.createElement('div'); meta.className = 'news-meta';
    const category = document.createElement('span'); category.className = 'news-category'; category.textContent = item.category || '関連情報';
    const source = document.createElement('span'); source.className = 'source'; source.textContent = item.source;
    const time = document.createElement('time'); time.textContent = item.time;
    const origin = document.createElement('span');
    const sample = isSampleNewsItem(item);
    origin.className = `news-origin ${sample ? 'sample' : 'real'}`;
    origin.textContent = sample ? 'サンプル' : '実ニュース';
    meta.append(category, origin, source, time); li.append(link, meta); list.append(li);
  });
  const errorBox = scope.querySelector('.news-error');
  errorBox.textContent = newsError || NEWS_ERROR_MESSAGE; errorBox.hidden = !newsError;
  const summary = scope.querySelector('.fact-summary p');
  try {
    summary.textContent = generateAISummary(items);
  } catch (error) {
    console.error(`AI summary generation failed for ${symbol}:`, error);
    summary.textContent = SUMMARY_ERROR_MESSAGE;
  }
}

function renderNotes(scope, stock) {
  const notes = [...(stock.notes || [])].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const latestDate = notes[0]?.date ? formatNoteDate(notes[0].date) : '—';
  scope.querySelector('.card-note-count').textContent = `${notes.length}件・最終 ${latestDate}`;
  const filter = scope.querySelector('.note-filter');
  const availableKinds = [...new Set([...NOTE_KINDS, ...notes.map(note => note.kind || 'その他')])];
  filter.innerHTML = '';
  [['all', 'すべて'], ...availableKinds.map(kind => [kind, kind])].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; filter.append(option);
  });
  const requestedFilter = noteFilters.get(stock.id) || 'all';
  const activeFilter = [...filter.options].some(option => option.value === requestedFilter) ? requestedFilter : 'all';
  filter.value = activeFilter;
  const visibleNotes = activeFilter === 'all' ? notes : notes.filter(note => (note.kind || 'その他') === activeFilter);
  scope.querySelector('.history-stats').textContent = `${visibleNotes.length}件表示 / 全${notes.length}件・新しい順`;
  const history = scope.querySelector('.note-history');
  history.innerHTML = '';
  filter.addEventListener('change', event => { noteFilters.set(stock.id, event.target.value); renderNotes(scope, stock); });
  if (!visibleNotes.length) {
    const empty = document.createElement('li'); empty.className = 'no-notes'; empty.textContent = notes.length ? 'この分類のメモはありません。' : 'まだメモがありません。気になった理由や確認事項を残せます。'; history.append(empty); return;
  }
  visibleNotes.forEach(note => {
    const item = document.createElement('li'); item.className = 'note-item';
    const head = document.createElement('div'); head.className = 'note-item-head';
    const date = document.createElement('time'); date.className = 'note-date-label'; date.dateTime = note.date; date.textContent = formatNoteDate(note.date);
    const kind = document.createElement('span'); kind.className = 'note-kind-label'; kind.textContent = note.kind || 'その他';
    const text = document.createElement('p'); text.textContent = note.text;
    const remove = document.createElement('button'); remove.className = 'note-delete'; remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `${formatNoteDate(note.date)}のメモを削除`); remove.addEventListener('click', () => removeNote(stock.id, note.id));
    head.append(date, kind); item.append(head, text, remove); history.append(item);
  });
}

function formatNoteDate(value) {
  const [year, month, day] = value.split('-');
  return `${year}.${month}.${day}`;
}

function addNote(event, stockId) {
  event.preventDefault();
  const stock = stocks.find(item => item.id === stockId); if (!stock) return;
  const form = event.currentTarget; const text = form.querySelector('.note-text').value.trim(); if (!text) return;
  stock.notes ||= [];
  stock.notes.push({ id: crypto.randomUUID(), date: form.querySelector('.note-date').value || todayDate(), kind: form.querySelector('.note-kind').value, text, createdAt: Date.now() });
  saveStocks(); render();
}

function removeNote(stockId, noteId) {
  const stock = stocks.find(item => item.id === stockId); if (!stock) return;
  stock.notes = (stock.notes || []).filter(note => note.id !== noteId); saveStocks(); render();
}

function renderAllCharts() {
  document.querySelectorAll('.stock-card').forEach(card => {
    const stock = stocks.find(item => item.id === card.dataset.id);
    if (stock) renderChart(stock.symbol, getOrCreateChartHistory(stock), card);
  });
}

async function changeChartRange(stockId, range) {
  if (!CHART_RANGE_CONFIG[range]) return;
  const stock = stocks.find(item => item.id === stockId);
  const card = document.querySelector(`.stock-card[data-id="${stockId}"]`);
  if (!stock || !card) return;
  chartRanges.set(stockId, range);
  const panel = card.querySelector('.chart-panel');
  panel.classList.add('loading');
  card.querySelectorAll('.chart-range-button').forEach(button => { button.disabled = true; });
  try {
    const chartData = await fetchChartData(stock.symbol, range);
    priceHistories.set(stockId, chartData);
    renderChart(stock.symbol, chartData, card);
  } finally {
    panel.classList.remove('loading');
    card.querySelectorAll('.chart-range-button').forEach(button => { button.disabled = false; });
  }
}

function renderChart(symbol, chartData, card) {
  const stock = stocks.find(item => item.symbol === symbol);
  const points = chartData?.points;
  if (!stock || !card || !Array.isArray(points) || points.length < 2) return;
  const selectedRange = chartData.range || chartRanges.get(stock.id) || DEFAULT_CHART_RANGE;
  const rangeLabel = CHART_RANGE_CONFIG[selectedRange]?.label || CHART_RANGE_CONFIG[DEFAULT_CHART_RANGE].label;
  const sourceLabel = card.querySelector('.chart-data-source');
  sourceLabel.textContent = chartData.source === 'api' ? String(chartData.provider || 'API').toUpperCase() : chartData.source === 'demo-fallback' ? 'SAMPLE FALLBACK' : 'SAMPLE';
  sourceLabel.classList.toggle('fallback', chartData.source === 'demo-fallback');
  card.querySelectorAll('.chart-range-button').forEach(button => {
    const active = button.dataset.range === selectedRange;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const canvas = card.querySelector('.price-chart');
  canvas.setAttribute('aria-label', `${stock.name}の過去${rangeLabel}の価格推移を示す折れ線グラフ`);
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const width = rect.width; const height = rect.height;
  const padding = { top: 18, right: 72, bottom: 18, left: 14 };
  const plotRight = width - padding.right;
  const plotBottom = height - padding.bottom;
  const plotWidth = Math.max(1, plotRight - padding.left);
  const plotHeight = Math.max(1, plotBottom - padding.top);
  const min = Math.min(...points); const max = Math.max(...points); const valueRange = Math.max(max - min, stock.price * .001);
  const styles = getComputedStyle(document.body); const lineColor = styles.getPropertyValue(stock.change >= 0 ? '--green' : '--red').trim();
  const gridColor = styles.getPropertyValue('--line').trim();
  ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
  [0, .5, 1].forEach(position => { const y = padding.top + plotHeight * position; ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(plotRight, y); ctx.stroke(); });
  const coordinates = points.map((value, index) => ({ x: padding.left + index * plotWidth / (points.length - 1), y: padding.top + (max - value) / valueRange * plotHeight }));
  const gradient = ctx.createLinearGradient(0, padding.top, 0, plotBottom); gradient.addColorStop(0, `${lineColor}35`); gradient.addColorStop(1, `${lineColor}00`);
  ctx.beginPath(); coordinates.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.lineTo(coordinates.at(-1).x, plotBottom); ctx.lineTo(coordinates[0].x, plotBottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); coordinates.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  const latest = coordinates.at(-1); ctx.beginPath(); ctx.arc(latest.x, latest.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = lineColor; ctx.fill();
  card.querySelector('.chart-high').textContent = formatPrice(stock, max); card.querySelector('.chart-low').textContent = formatPrice(stock, min);
}

async function tickPrices() {
  await Promise.all(stocks.map(async stock => {
    if ((stock.updateMode || assetTypeSettings[stock.type]?.updateMode) === 'daily') return;
    const card = document.querySelector(`.stock-card[data-id="${stock.id}"]`);
    const state = runtimeCardData.get(stock.id) || { news: [], error: null, lastMarketAttempt: 0 };
    const apiPrice = usesApiPrice(stock);
    const shouldRefreshPrice = !apiPrice || Date.now() - state.lastMarketAttempt >= API_REFRESH_INTERVAL;

    if (shouldRefreshPrice) {
      state.lastMarketAttempt = Date.now();
      try {
        const marketData = await fetchMarketData(stock.symbol);
        Object.assign(stock, marketData);
        state.error = null;
      } catch (error) {
        console.error(`Market data refresh failed for ${stock.symbol}:`, error);
        state.error = PRICE_ERROR_MESSAGE;
      }
    }

    const chartData = getOrCreateChartHistory(stock);
    if (chartData.source !== 'api') {
      const lastChartValue = chartData.points.at(-1) || stock.price;
      const chartValue = shouldRefreshPrice && !state.error ? stock.price : lastChartValue * (1 + (Math.random() - .5) * .0016);
      const maxPoints = CHART_RANGE_CONFIG[chartData.range]?.demoPoints || CHART_RANGE_CONFIG[DEFAULT_CHART_RANGE].demoPoints;
      chartData.points.push(chartValue); if (chartData.points.length > maxPoints) chartData.points.shift();
    }
    runtimeCardData.set(stock.id, state);
    if (!card) return;
    const errorBox = card.querySelector('.data-error');
    errorBox.textContent = state.error || DATA_ERROR_MESSAGE; errorBox.hidden = !state.error;
    updatePriceElements(card, stock); renderChart(stock.symbol, chartData, card);
    const status = evaluateAlert(stock); card.classList.toggle('triggered', status.active);
    const alertStatus = card.querySelector('.alert-status'); alertStatus.textContent = status.active ? '条件に一致' : '監視中'; alertStatus.classList.toggle('active', status.active);
  }));
  saveStocks(); updateDashboardCounts(); updateTimestamp();
}

function updateDashboardCounts() {
  document.querySelector('#noteCount').textContent = stocks.reduce((total, stock) => total + (stock.notes?.length || 0), 0);
}
function updateTimestamp() { document.querySelector('#lastUpdated').textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

function removeStock(id, name) {
  if (!confirm(`${name}をノートから削除しますか？ メモ履歴も削除されます。`)) return;
  stocks = stocks.filter(stock => stock.id !== id); priceHistories.delete(id); chartRanges.delete(id); runtimeCardData.delete(id); noteFilters.delete(id); saveStocks(); render();
}

async function showSuggestions(query) {
  const results = await stockDataProvider.search(query); suggestions.innerHTML = ''; activeSuggestionIndex = -1;
  results.forEach((stock, index) => {
    const item = document.createElement('li'); item.id = `suggestion-${index}`; item.dataset.symbol = stock.symbol; item.setAttribute('role', 'option');
    item.innerHTML = `<span class="suggestion-name"></span><span class="suggestion-symbol"></span><span class="suggestion-classification"></span>`;
    item.querySelector('.suggestion-name').textContent = stock.name; item.querySelector('.suggestion-symbol').textContent = stock.symbol; item.querySelector('.suggestion-classification').textContent = `${stock.type} / ${stock.region}`;
    item.addEventListener('mousedown', event => { event.preventDefault(); chooseSuggestion(stock); }); suggestions.append(item);
  });
  suggestions.hidden = results.length === 0; symbolInput.setAttribute('aria-expanded', String(results.length > 0));
}

function chooseSuggestion(stock) {
  selectedSuggestion = stock; symbolInput.value = stock.symbol; nameInput.value = stock.name; document.querySelector('#typeInput').value = stock.type; closeSuggestions(); nameInput.focus();
}
function closeSuggestions() { suggestions.hidden = true; suggestions.innerHTML = ''; symbolInput.setAttribute('aria-expanded', 'false'); symbolInput.removeAttribute('aria-activedescendant'); activeSuggestionIndex = -1; }

symbolInput.addEventListener('input', event => {
  const upperValue = event.target.value.toUpperCase();
  if (event.target.value !== upperValue) event.target.value = upperValue;
  selectedSuggestion = null;
  showSuggestions(event.target.value);
});
symbolInput.addEventListener('invalid', () => { document.querySelector('#formMessage').textContent = '銘柄コードを入力してください。'; });
symbolInput.addEventListener('keydown', event => {
  const items = [...suggestions.querySelectorAll('[role="option"]')]; if (!items.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); activeSuggestionIndex = event.key === 'ArrowDown' ? (activeSuggestionIndex + 1) % items.length : (activeSuggestionIndex - 1 + items.length) % items.length;
    items.forEach((item, index) => { item.classList.toggle('active', index === activeSuggestionIndex); item.setAttribute('aria-selected', String(index === activeSuggestionIndex)); }); symbolInput.setAttribute('aria-activedescendant', items[activeSuggestionIndex].id);
  } else if (event.key === 'Enter' && activeSuggestionIndex >= 0) { event.preventDefault(); chooseSuggestion(stockDataProvider.getBySymbol(items[activeSuggestionIndex].dataset.symbol)); }
  else if (event.key === 'Escape') closeSuggestions();
});
symbolInput.addEventListener('blur', () => setTimeout(closeSuggestions, 120));

form.addEventListener('submit', async event => {
  event.preventDefault();
  const symbol = normalizeSymbol(symbolInput.value);
  if (!symbol) { document.querySelector('#formMessage').textContent = '銘柄コードを入力してください。'; symbolInput.focus(); return; }
  if (!/^[A-Z0-9^.\-:]+$/.test(symbol)) { document.querySelector('#formMessage').textContent = '銘柄コードは英数字と ^ . - : で入力してください。'; symbolInput.focus(); return; }
  const found = selectedSuggestion?.symbol === symbol ? selectedSuggestion : stockDataProvider.getBySymbol(symbol);
  const isJapanese = found?.region === '日本' || /\.T$/.test(symbol) || /^\d{4,5}$/.test(symbol);
  const selectedType = document.querySelector('#typeInput').value;
  const displayName = nameInput.value.trim() || found?.name || symbol;
  const resolved = found
    ? { ...found, symbol, name: displayName, type: selectedType }
    : { name: displayName, symbol, type: selectedType, region: isJapanese ? '日本' : '米国', market: isJapanese ? '東証（仮）' : '米国市場（仮）', price: isJapanese ? 1850 : 100, currency: isJapanese ? 'JPY' : 'USD', change: 0 };
  if (stocks.some(stock => normalizeSymbol(stock.symbol) === symbol)) { document.querySelector('#formMessage').textContent = 'この銘柄コードは登録済みです。'; return; }
  const initialMemo = document.querySelector('#initialMemoInput').value.trim();
  const notes = initialMemo ? [{ id: crypto.randomUUID(), date: todayDate(), kind: 'なぜ気になったか', text: initialMemo, createdAt: Date.now() }] : [];
  const newStock = normalizeStoredStock({ id: crypto.randomUUID(), ...resolved, assetClass: getAssetClass(resolved.type), memo: '', notes, favorite: false, tags: [], updateMode: assetTypeSettings[resolved.type]?.updateMode || 'realtime', direction: 'above', target: '', percent: '' });
  stocks.unshift(newStock);
  saveStocks(); render(); form.reset(); selectedSuggestion = null; closeSuggestions(); document.querySelector('#formMessage').textContent = `${resolved.name}をマーケットノートに追加しました。`;
  await refreshStockData(newStock);
  saveStocks(); render();
});

function applyTheme(theme) {
  const dark = theme === 'dark'; document.body.classList.toggle('dark', dark); const button = document.querySelector('#themeButton');
  button.setAttribute('aria-pressed', String(dark)); button.setAttribute('aria-label', dark ? 'ライトモードに切り替える' : 'ダークモードに切り替える');
  button.querySelector('.theme-icon').textContent = dark ? '☀' : '☾'; button.querySelector('.theme-text').textContent = dark ? 'ライト' : 'ダーク'; requestAnimationFrame(renderAllCharts);
}
document.querySelector('#themeButton').addEventListener('click', () => { const next = document.body.classList.contains('dark') ? 'light' : 'dark'; localStorage.setItem(THEME_KEY, next); applyTheme(next); });
document.querySelector('#jsonExportButton').addEventListener('click', exportJsonBackup);
document.querySelector('#csvExportButton').addEventListener('click', exportNotesCsv);
jsonImportInput.addEventListener('change', event => importJsonBackup(event.target.files?.[0]));
window.addEventListener('resize', () => requestAnimationFrame(renderAllCharts));

async function initializeApp() {
  const effectiveMode = getEffectiveDataMode();
  document.querySelector('#dataModeLabel').textContent = effectiveMode === 'api' ? '実データ接続' : DATA_MODE === 'api' ? 'サンプル表示（中継API未設定）' : 'サンプル表示';
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');
  await refreshAllData();
  render();
  setInterval(() => tickPrices(), UPDATE_INTERVAL);
}

initializeApp();
