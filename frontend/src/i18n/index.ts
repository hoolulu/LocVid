/**
 * 轻量 i18n（LocVid 前端）：
 * - 无第三方依赖，字典 ts 文件 + 响应式 locale
 * - 默认跟随浏览器语言（navigator.language 以 zh 开头 → 中文，否则英文）
 * - 设置页可手动切换并持久化到 localStorage（lg-locale）
 * - t(key, params?)：key 缺失时回退中文，再回退 key 本身（便于审计漏网）
 */
import { ref } from 'vue'
import zh from './zh'
import en from './en'

export type Locale = 'zh' | 'en'
export type MessageDict = Record<string, string>

const LOCALE_KEY = 'lg-locale'
const dicts: Record<Locale, MessageDict> = { zh, en }

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* ignore */
  }
  try {
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'zh'
  }
}

export const locale = ref<Locale>(detectLocale())

export function setLocale(l: Locale): void {
  locale.value = l
  try {
    localStorage.setItem(LOCALE_KEY, l)
  } catch {
    /* ignore */
  }
}

export function t(key: string, params?: Record<string, unknown>): string {
  const dict: MessageDict = dicts[locale.value] ?? zh
  const zhDict: MessageDict = zh
  let s = dict[key] ?? zhDict[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}

export function useI18n() {
  return { locale, t, setLocale }
}
