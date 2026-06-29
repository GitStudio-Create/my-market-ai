const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://kenji-nakakawa0002-debug.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8769',
  'http://127.0.0.1:8769'
];
const SYMBOL_PATTERN = /^[A-Z0-9.^:_/-]{1,32}$/;
const CHART_RANGES = {
  '1d': { interval: '5min', outputsize: 78 },
  '1w': { interval: '1h', outputsize: 35 },
  '1m': { interval: '1day', outputsize: 30 }
};

class ApiError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  const allowedOrigin = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : !origin ? allowed[0] : null;
  if (!allowedOrigin) return null;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResponse(body, status, cors, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      ...cors
    }
  });
}

function normalizeSymbol(url) {
  const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();
  if (!symbol) throw new ApiError('symbol を指定してください。', 400, 'SYMBOL_REQUIRED');
  if (!SYMBOL_PATTERN.test(symbol)) throw new ApiError('symbol の形式が正しくありません。', 400, 'INVALID_SYMBOL');
  return symbol;
}

function requireApiKey(env) {
  const apiKey = String(env.TWELVE_DATA_API_KEY || '').trim();
  if (!apiKey) throw new ApiError('市場データAPIが設定されていません。', 503, 'API_KEY_NOT_CONFIGURED');
  return apiKey;
}

async function fetchTwelveData(path, params, env) {
  const url = new URL(path, TWELVE_DATA_BASE_URL);
  Object.entries({ ...params, apikey: requireApiKey(env) }).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  let response;
  try {
    response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('市場データ提供元へ接続できませんでした。', 502, 'UPSTREAM_CONNECTION_ERROR');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('市場データ提供元から不正な応答がありました。', 502, 'UPSTREAM_INVALID_RESPONSE');
  }

  if (!response.ok || payload?.status === 'error') {
    const rateLimited = response.status === 429 || payload?.code === 429;
    throw new ApiError(
      rateLimited ? '市場データAPIの利用上限に達しました。時間をおいて再度お試しください。' : '市場データを取得できませんでした。',
      rateLimited ? 429 : 502,
      rateLimited ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_ERROR'
    );
  }
  return payload;
}

function fetchedAtFromTimestamp(timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : new Date().toISOString();
}

async function marketData(url, env) {
  const symbol = normalizeSymbol(url);
  const payload = await fetchTwelveData('/quote', { symbol }, env);
  const price = Number(payload.close);
  const change = Number(payload.percent_change);
  if (!Number.isFinite(price)) throw new ApiError('現在価格を確認できませんでした。', 502, 'INVALID_MARKET_DATA');

  return {
    data: {
      symbol,
      price,
      change: Number.isFinite(change) ? change : 0,
      priceChange: Number(payload.change) || 0,
      previousClose: Number(payload.previous_close) || null,
      currency: payload.currency || 'USD',
      provider: 'Twelve Data',
      fetchedAt: fetchedAtFromTimestamp(payload.timestamp)
    }
  };
}

async function chartData(url, env) {
  const symbol = normalizeSymbol(url);
  const range = String(url.searchParams.get('range') || '1m').toLowerCase();
  const config = CHART_RANGES[range];
  if (!config) throw new ApiError('range は 1d、1w、1m のいずれかを指定してください。', 400, 'INVALID_RANGE');

  const payload = await fetchTwelveData('/time_series', {
    symbol,
    interval: config.interval,
    outputsize: config.outputsize,
    order: 'asc'
  }, env);
  const values = (payload.values || []).map(item => ({ datetime: item.datetime, close: Number(item.close) })).filter(item => Number.isFinite(item.close));
  if (values.length < 2) throw new ApiError('チャートに必要なデータが不足しています。', 502, 'INSUFFICIENT_CHART_DATA');

  return {
    data: {
      symbol,
      range,
      interval: config.interval,
      currency: payload.meta?.currency || null,
      points: values.map(item => item.close),
      values,
      provider: 'Twelve Data',
      fetchedAt: new Date().toISOString()
    }
  };
}

function sampleNews(url) {
  const symbol = normalizeSymbol(url);
  return {
    data: {
      items: [
        {
          title: `${symbol}に関するニュースAPIは現在準備中です`,
          source: 'My Market AI Sample',
          category: '参考情報',
          time: 'サンプル',
          url: 'https://example.com/my-market-ai/news-sample',
          isSample: true
        },
        {
          title: '実ニュース接続後は配信元が提供する記事URLを表示します',
          source: 'My Market AI Sample',
          category: 'お知らせ',
          time: 'サンプル',
          url: 'https://example.com/my-market-ai/news-provider-sample',
          isSample: true
        }
      ],
      provider: 'Sample',
      fetchedAt: new Date().toISOString()
    }
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (!cors) return jsonResponse({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'このOriginからのアクセスは許可されていません。' } }, 403, {});
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GETメソッドのみ利用できます。' } }, 405, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return jsonResponse({ data: { status: 'ok', service: 'My Market AI data proxy' } }, 200, cors, 'no-store');
      }
      if (url.pathname === '/market') return jsonResponse(await marketData(url, env), 200, cors, 'public, max-age=30');
      if (url.pathname === '/chart') return jsonResponse(await chartData(url, env), 200, cors, 'public, max-age=300');
      if (url.pathname === '/news') return jsonResponse(sampleNews(url), 200, cors, 'public, max-age=300');
      throw new ApiError('指定されたエンドポイントはありません。', 404, 'NOT_FOUND');
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('中継APIで予期しないエラーが発生しました。');
      return jsonResponse({ error: { code: apiError.code, message: apiError.message } }, apiError.status, cors);
    }
  }
};
