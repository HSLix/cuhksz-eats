const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js'
const CONSENT_STORAGE_KEY = 'cuhksz-eats:umami-consent'
const ACCEPTED = 'accepted'
const REJECTED = 'rejected'

export const analyticsConfig = __UMAMI_CONFIG__
export const analyticsEnabled = Boolean(analyticsConfig.websiteId)

let scriptLoadPromise
let lastTrackedPath

function readStoredConsent() {
  try {
    const value = window.sessionStorage.getItem(CONSENT_STORAGE_KEY)
    return value === ACCEPTED || value === REJECTED ? value : null
  } catch {
    return null
  }
}

export function hasAnalyticsConsent() {
  return readStoredConsent() === ACCEPTED
}

export function getAnalyticsConsent() {
  return readStoredConsent()
}

export function saveAnalyticsConsent(value) {
  try {
    window.sessionStorage.setItem(CONSENT_STORAGE_KEY, value ? ACCEPTED : REJECTED)
  } catch {
    // A blocked sessionStorage must never make analytics load without consent.
  }
}

export function loadAnalytics() {
  if (!analyticsEnabled || !hasAnalyticsConsent()) return Promise.resolve(false)
  if (window.umami) return Promise.resolve(true)
  if (scriptLoadPromise) return scriptLoadPromise

  window.cuhkszEatsUmamiBeforeSend = (_type, payload) => (
    hasAnalyticsConsent() ? payload : undefined
  )

  scriptLoadPromise = new Promise((resolve) => {
    const script = document.createElement('script')
    script.id = 'umami-analytics-script'
    script.src = UMAMI_SCRIPT_URL
    script.defer = true
    script.dataset.websiteId = analyticsConfig.websiteId
    script.dataset.autoPageview = 'false'
    script.dataset.excludeSearch = 'true'
    script.dataset.excludeHash = 'true'
    script.dataset.doNotTrack = 'true'
    script.dataset.beforeSend = 'cuhkszEatsUmamiBeforeSend'
    script.addEventListener('load', () => resolve(true), { once: true })
    script.addEventListener('error', () => {
      script.remove()
      scriptLoadPromise = undefined
      resolve(false)
    }, { once: true })
    document.head.append(script)
  })

  return scriptLoadPromise
}

export async function trackPage(path) {
  if (!analyticsEnabled || !hasAnalyticsConsent() || path === lastTrackedPath) return
  if (!await loadAnalytics() || !hasAnalyticsConsent() || !window.umami) return

  window.umami.track((properties) => ({
    ...properties,
    url: path,
    title: document.title,
  }))
  lastTrackedPath = path
}

export function withdrawAnalyticsConsent() {
  saveAnalyticsConsent(false)
  lastTrackedPath = undefined
  document.getElementById('umami-analytics-script')?.remove()
}
