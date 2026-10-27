const SERVICE = 'iosnotify';
const PROTOCOL = 1;

export type ServerHello = {
  baseUrl: string;
  instanceId: string;
};

function isBareAddress(host: string) {
  return host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

export function normalizeBaseUrl(raw: string): string {
  let value = raw.trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const url = new URL(value);
    if (!url.port && url.protocol === 'http:' && isBareAddress(url.hostname)) {
      url.port = '8787';
    }
    return url.origin;
  } catch {
    return '';
  }
}

async function request(url: string, apiKey?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: apiKey ? { 'X-Api-Key': apiKey } : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Сервер не ответил');
    }
    throw new Error('Сервер недоступен');
  } finally {
    clearTimeout(timer);
  }
}

function readHello(body: unknown): { instanceId: string } {
  const data = body as { service?: string; protocol?: number; instanceId?: string };
  if (data?.service !== SERVICE || data?.protocol !== PROTOCOL || !data.instanceId) {
    throw new Error('По этому адресу не IOSnotify');
  }
  return { instanceId: data.instanceId };
}

export async function hello(raw: string): Promise<ServerHello> {
  const baseUrl = normalizeBaseUrl(raw);
  if (!baseUrl) throw new Error('Укажите адрес сервера');
  const response = await request(`${baseUrl}/api/health`);
  if (!response.ok) throw new Error('По этому адресу не IOSnotify');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('По этому адресу не IOSnotify');
  }
  const identity = readHello(body);
  return { baseUrl, instanceId: identity.instanceId };
}

export async function login(baseUrl: string, apiKey: string, instanceId: string) {
  const key = apiKey.trim();
  if (!key) throw new Error('Введите ключ');
  const response = await request(`${baseUrl}/api/session`, key);
  if (response.status === 401) throw new Error('Неверный ключ');
  if (!response.ok) throw new Error('Не удалось войти');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Сервер ответил чужим именем');
  }
  const identity = readHello(body);
  if (identity.instanceId !== instanceId) {
    throw new Error('Сервер ответил чужим именем');
  }
}
