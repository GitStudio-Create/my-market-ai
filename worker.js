const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const NEWS_LOOKBACK_DAYS = 30;
const NEWS_ITEM_LIMIT = 10;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://gitstudio-create.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8769',
  'http://127.0.0.1:8769'
];
const SYMBOL_PATTERN = /^[A-Z0-9.^:_/-]{1,32}$/;
const CHART_RANGES = {
  '1d': {
    attempts: [
      { interval: '5min', outputsize: 78, preferredPoints: 12, mode: 'intraday' },
      { interval: '15min', outputsize: 96, preferredPoints: 8, mode: 'intraday' },
      { interval: '1day', outputsize: 5, preferredPoints: 2, mode: 'close' }
    ]
  },
  '1w': {
    attempts: [
      { interval: '1h', outputsize: 35, preferredPoints: 20, mode: 'intraday' },
      { interval: '1h', outputsize: 80, preferredPoints: 20, mode: 'intraday' },
      { interval: '1day', outputsize: 10, preferredPoints: 5, mode: 'close' }
    ]
  },
  '1m': {
    attempts: [
      { interval: '1day', outputsize: 30, preferredPoints: 20, mode: 'daily' },
      { interval: '1day', outputsize: 60, preferredPoints: 20, mode: 'daily' }
    ]
  }
};

class ApiError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
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

function normalizeSymbolForApi(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!symbol) throw new ApiError('symbol を指定してください。', 400, 'SYMBOL_REQUIRED');
  if (!SYMBOL_PATTERN.test(symbol)) throw new ApiError('symbol の形式が正しくありません。', 400, 'INVALID_SYMBOL');
  if (/^\d{4}\.T$/.test(symbol)) {
    return { requestedSymbol: symbol, symbol: symbol.slice(0, -2), exchange: 'JPX', micCode: 'XJPX' };
  }
  return { requestedSymbol: symbol, symbol, exchange: null, micCode: null };
}

function symbolFromUrl(url) {
  return normalizeSymbolForApi(url.searchParams.get('symbol'));
}

function symbolParams(symbolInfo) {
  return { symbol: symbolInfo.symbol, ...(symbolInfo.exchange ? { exchange: symbolInfo.exchange } : {}) };
}

function requireApiKey(env) {
  const apiKey = String(env.TWELVE_DATA_API_KEY || '').trim();
  if (!apiKey) throw new ApiError('市場データAPIが設定されていません。', 503, 'API_KEY_NOT_CONFIGURED');
  return apiKey;
}

function requireFinnhubApiKey(env) {
  const apiKey = String(env.FINNHUB_API_KEY || '').trim();
  if (!apiKey) throw new ApiError('ニュースAPIが設定されていません。', 503, 'NEWS_API_KEY_NOT_CONFIGURED');
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
    const upstreamReason = String(payload?.message || '').replace(/apikey=[^&\s]+/gi, 'apikey=[redacted]').slice(0, 240);
    throw new ApiError(
      rateLimited ? '市場データAPIの利用上限に達しました。時間をおいて再度お試しください。' : '市場データを取得できませんでした。',
      rateLimited ? 429 : 502,
      rateLimited ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_ERROR',
      { provider: 'Twelve Data', upstreamCode: payload?.code || response.status, reason: upstreamReason || null }
    );
  }
  return payload;
}

function fetchedAtFromTimestamp(timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : new Date().toISOString();
}

async function marketData(url, env) {
  const symbolInfo = symbolFromUrl(url);
  const payload = await fetchTwelveData('/quote', symbolParams(symbolInfo), env);
  const price = Number(payload.close);
  const change = Number(payload.percent_change);
  if (!Number.isFinite(price)) throw new ApiError('現在価格を確認できませんでした。', 502, 'INVALID_MARKET_DATA');
  const marketState = payload.is_market_open === false ? 'close' : 'live';

  return {
    data: {
      symbol: symbolInfo.requestedSymbol,
      apiSymbol: symbolInfo.symbol,
      exchange: payload.exchange || symbolInfo.exchange,
      price,
      change: Number.isFinite(change) ? change : 0,
      priceChange: Number(payload.change) || 0,
      previousClose: Number(payload.previous_close) || null,
      currency: payload.currency || 'USD',
      provider: 'Twelve Data',
      marketState,
      statusMessage: marketState === 'close' ? '市場終了後の最終取得価格（終値ベース）を表示しています。' : '',
      fetchedAt: fetchedAtFromTimestamp(payload.timestamp)
    }
  };
}

function parseChartValues(payload) {
  return (payload?.values || [])
    .map(item => ({ datetime: item.datetime, close: Number(item.close) }))
    .filter(item => item.datetime && Number.isFinite(item.close));
}

function exchangeLocalNowParts(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function minutesSinceExchangeTime(datetime, timeZone) {
  const match = String(datetime || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return Infinity;
  const latest = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  const now = exchangeLocalNowParts(timeZone);
  const current = Date.UTC(now.year, now.month - 1, now.day, now.hour, now.minute, now.second);
  return Math.max(0, (current - latest) / 60000);
}

function isCloseBased(attempt, payload, values) {
  if (attempt.mode === 'close') return true;
  const latest = values.at(-1)?.datetime;
  const ageMinutes = minutesSinceExchangeTime(latest, payload?.meta?.exchange_timezone);
  const staleAfter = { '5min': 45, '15min': 90, '1h': 240, '1day': 2160 }[attempt.interval] || 240;
  return ageMinutes > staleAfter;
}

function chartStatusMessage(attempt, closeBased, attemptIndex, limited = false) {
  if (attempt.mode === 'close') return '時間足を取得できないため、直近営業日の終値系列を表示しています。';
  if (closeBased) return '市場終了後または休場日のため、直近営業日の実データを表示しています。';
  if (limited) return '取得件数は少なめですが、取得できた実データを表示しています。';
  if (attemptIndex > 0) return '取得条件を広げて取得した実データを表示しています。';
  return '';
}

async function chartData(url, env) {
  const symbolInfo = symbolFromUrl(url);
  const range = String(url.searchParams.get('range') || '1m').toLowerCase();
  const config = CHART_RANGES[range];
  if (!config) throw new ApiError('range は 1d、1w、1m のいずれかを指定してください。', 400, 'INVALID_RANGE');

  let best = null;
  const attemptErrors = [];
  for (let index = 0; index < config.attempts.length; index++) {
    const attempt = config.attempts[index];
    try {
      const payload = await fetchTwelveData('/time_series', {
        ...symbolParams(symbolInfo),
        interval: attempt.interval,
        outputsize: attempt.outputsize,
        order: 'asc'
      }, env);
      const values = parseChartValues(payload);
      if (values.length >= 2 && (!best || values.length > best.values.length)) best = { payload, values, attempt, index };
      if (values.length >= attempt.preferredPoints) {
        best = { payload, values, attempt, index };
        break;
      }
      attemptErrors.push({ interval: attempt.interval, outputsize: attempt.outputsize, reason: `取得件数 ${values.length}件` });
    } catch (error) {
      attemptErrors.push({ interval: attempt.interval, outputsize: attempt.outputsize, reason: error.details?.reason || error.message, code: error.code });
    }
  }

  if (!best || best.values.length < 2) {
    throw new ApiError('チャートの実データを取得できませんでした。', 502, 'CHART_ALL_ATTEMPTS_FAILED', {
      symbol: symbolInfo.requestedSymbol,
      apiSymbol: symbolInfo.symbol,
      exchange: symbolInfo.exchange,
      attempts: attemptErrors
    });
  }

  const { payload, values, attempt, index } = best;
  const closeBased = isCloseBased(attempt, payload, values);
  const limited = values.length < attempt.preferredPoints;

  return {
    data: {
      symbol: symbolInfo.requestedSymbol,
      apiSymbol: symbolInfo.symbol,
      exchange: payload.meta?.exchange || symbolInfo.exchange,
      range,
      interval: attempt.interval,
      currency: payload.meta?.currency || null,
      points: values.map(item => item.close),
      values,
      provider: 'Twelve Data',
      marketState: closeBased ? 'close' : 'live',
      dataMode: closeBased ? 'close' : attempt.mode,
      statusMessage: chartStatusMessage(attempt, closeBased, index, limited),
      latestAt: values.at(-1).datetime,
      attempts: index + 1,
      fetchedAt: new Date().toISOString()
    }
  };
}

function dateDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function sanitizeNewsText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

async function fetchFinnhubNews(symbol, env) {
  const url = new URL('company-news', `${FINNHUB_BASE_URL}/`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('from', dateDaysAgo(NEWS_LOOKBACK_DAYS));
  url.searchParams.set('to', new Date().toISOString().slice(0, 10));
  url.searchParams.set('token', requireFinnhubApiKey(env));

  let response;
  try {
    response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('ニュース提供元へ接続できませんでした。', 502, 'NEWS_UPSTREAM_CONNECTION_ERROR');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('ニュース提供元から不正な応答がありました。', 502, 'NEWS_UPSTREAM_INVALID_RESPONSE');
  }

  if (!response.ok || payload?.error || !Array.isArray(payload)) {
    const rateLimited = response.status === 429 || /limit/i.test(String(payload?.error || ''));
    const reason = sanitizeNewsText(payload?.error || '', 240) || null;
    throw new ApiError(
      rateLimited ? 'ニュースAPIの利用上限に達しました。時間をおいて再度お試しください。' : 'ニュースを取得できませんでした。',
      rateLimited ? 429 : 502,
      rateLimited ? 'NEWS_RATE_LIMIT' : 'NEWS_UPSTREAM_ERROR',
      { provider: 'Finnhub', reason }
    );
  }
  return payload;
}

async function newsData(url, env) {
  const symbolInfo = symbolFromUrl(url);
  const requestedSymbol = symbolInfo.requestedSymbol;
  const payload = await fetchFinnhubNews(requestedSymbol, env);
  const seenUrls = new Set();
  const items = payload
    .filter(item => item?.headline && isHttpUrl(item?.url))
    .sort((left, right) => Number(right.datetime || 0) - Number(left.datetime || 0))
    .filter(item => {
      if (seenUrls.has(item.url)) return false;
      seenUrls.add(item.url);
      return true;
    })
    .slice(0, NEWS_ITEM_LIMIT)
    .map(item => ({
      title: sanitizeNewsText(item.headline, 300),
      source: sanitizeNewsText(item.source, 100) || '配信元不明',
      category: '企業ニュース',
      publishedAt: Number.isFinite(Number(item.datetime)) ? new Date(Number(item.datetime) * 1000).toISOString() : null,
      url: item.url,
      description: sanitizeNewsText(item.summary, 600),
      isSample: false,
      dataSource: 'api'
    }));

  return {
    data: {
      symbol: requestedSymbol,
      items,
      provider: 'Finnhub',
      statusMessage: items.length ? '' : '対象銘柄のニュースが見つかりませんでした。',
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
      if (url.pathname === '/news') return jsonResponse(await newsData(url, env), 200, cors, 'public, max-age=600');
      throw new ApiError('指定されたエンドポイントはありません。', 404, 'NOT_FOUND');
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError('中継APIで予期しないエラーが発生しました。');
      return jsonResponse({ error: { code: apiError.code, message: apiError.message, ...(apiError.details ? { details: apiError.details } : {}) } }, apiError.status, cors);
    }
  }
};
