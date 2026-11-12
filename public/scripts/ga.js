// Google Analytics 4 bootstrap (OPS-05 / SEC-07): an external same-origin file
// instead of an inline script, so the page needs no 'unsafe-inline'. The
// measurement id comes from the script tag's data-ga-id (an admin setting).
// Cookieless: client_storage none, anonymised IP. Loaded at idle after load.
(function () {
  var tag = document.currentScript
  var id = tag && tag.getAttribute('data-ga-id')
  if (!id || !/^G-[A-Z0-9]{4,16}$/.test(id)) return
  window.dataLayer = window.dataLayer || []
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments) }
  window.addEventListener('load', function () {
    var load = function () {
      var script = document.createElement('script')
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id)
      script.async = true
      document.head.appendChild(script)
      window.gtag('js', new Date())
      window.gtag('config', id, { client_storage: 'none', anonymize_ip: true })
    }
    if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 3000 })
    else window.setTimeout(load, 1800)
  })
})()
