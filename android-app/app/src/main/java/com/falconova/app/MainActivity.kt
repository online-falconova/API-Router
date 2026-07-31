package com.falconova.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.falconova.app.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pageReady = false
    private var splashHidden = false

    // Double-back-to-exit: timestamp of the last "would exit" back press + its toast.
    private var lastBackPressTime = 0L
    private var backToast: Toast? = null

    /**
     * Whether the web page's active scroll container is at its very top.
     * Reported from JS because the dashboard scrolls an inner `overflow-y:auto`
     * element (the document itself never scrolls, so [WebView.getScrollY] stays 0).
     * Written from the JS bridge thread, read on the UI thread → @Volatile.
     */
    @Volatile
    private var contentAtTop = true

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback ?: return@registerForActivityResult
            val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
                result.data?.let { data ->
                    val clip = data.clipData
                    when {
                        clip != null -> Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
                        data.data != null -> arrayOf(data.data!!)
                        else -> null
                    }
                }
            } else {
                null
            }
            callback.onReceiveValue(uris)
            filePathCallback = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Modern splash screen: install BEFORE super.onCreate so it shows instantly.
        // The system splash hands off to our in-app animated overlay, which stays
        // until the first page finishes loading — so there is no blank flash.
        installSplashScreen()

        super.onCreate(savedInstanceState)

        // Draw edge-to-edge, then re-apply the system-bar / keyboard insets as
        // padding on the content layer. This keeps the web header below the status
        // bar and keeps the chat input above the on-screen keyboard.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        applyWindowInsets()
        startSplashAnimation()

        configureWebView()

        binding.swipeRefresh.setColorSchemeResources(R.color.brand_accent)
        binding.swipeRefresh.setOnRefreshListener { binding.webView.reload() }

        // Eligibility is captured by EdgeSwipeRefreshLayout on ACTION_DOWN.
        // A refresh can only begin inside the top 48dp while both the WebView
        // and the page's active nested scroll container are already at the top.
        binding.swipeRefresh.canStartRefresh = {
            binding.webView.scrollY == 0 && contentAtTop
        }
        binding.swipeRefresh.setOnChildScrollUpCallback { _, _ ->
            binding.webView.scrollY > 0 || !contentAtTop
        }

        setupBackNavigation()

        if (savedInstanceState == null) {
            binding.webView.loadUrl(BuildConfigUrl.START_URL)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val webView = binding.webView
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        // Bridge used only so the page can tell us whether its scroll container is at
        // the top (see [contentAtTop]). Exposes a single boolean setter and no other
        // capability; in-app navigation is restricted to APP_HOST by
        // shouldOverrideUrlLoading, so no third-party page can reach it.
        webView.addJavascriptInterface(PullRefreshBridge(), JS_BRIDGE_NAME)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                val scheme = url.scheme?.lowercase()
                // Keep in-app navigation for our own host; hand off everything else to the OS.
                return if (scheme == "http" || scheme == "https") {
                    if (url.host?.endsWith(APP_HOST) == true) {
                        false
                    } else {
                        openExternally(url)
                        true
                    }
                } else {
                    // mailto:, tel:, intent:, etc.
                    openExternally(url)
                    true
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                pageReady = true
                binding.swipeRefresh.isRefreshing = false
                binding.progressBar.visibility = View.GONE
                hideSplash()
                // A freshly loaded page starts at the top; the injected script keeps
                // this in sync from then on.
                contentAtTop = true
                view.evaluateJavascript(SCROLL_TRACKER_JS, null)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                // Only surface errors for the main frame so sub-resource hiccups stay quiet.
                if (request.isForMainFrame) {
                    pageReady = true
                    binding.swipeRefresh.isRefreshing = false
                    binding.progressBar.visibility = View.GONE
                    hideSplash()
                    view.loadDataWithBaseURL(
                        null,
                        errorPageHtml(),
                        "text/html",
                        "utf-8",
                        null
                    )
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                binding.progressBar.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
                binding.progressBar.progress = newProgress
            }

            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    fileChooserLauncher.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        webView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(
                        android.os.Environment.DIRECTORY_DOWNLOADS,
                        guessFileName(url, contentDisposition, mimeType)
                    )
                }
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show()
            }
        })
    }

    private fun guessFileName(url: String, contentDisposition: String?, mimeType: String?): String {
        return android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType)
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: Exception) {
            Toast.makeText(this, R.string.no_app_to_open, Toast.LENGTH_SHORT).show()
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // While there is web history, back navigates the page as usual.
                if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                    return
                }
                // No history left → a back press would close the app. Require a
                // second press/swipe within the window to actually exit; the first
                // one just warns. This applies to both the button and the gesture.
                val now = System.currentTimeMillis()
                if (now - lastBackPressTime <= BACK_EXIT_WINDOW_MS) {
                    backToast?.cancel()
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                } else {
                    lastBackPressTime = now
                    backToast?.cancel()
                    backToast =
                        Toast.makeText(
                            this@MainActivity,
                            R.string.press_back_again,
                            Toast.LENGTH_SHORT
                        )
                    backToast?.show()
                }
            }
        })
    }

    private fun errorPageHtml(): String = """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            html,body{height:100%;margin:0}
            body{display:flex;align-items:center;justify-content:center;
                 background:#0B1F3A;color:#E8EEF6;
                 font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
            .card{max-width:340px;text-align:center;padding:24px}
            h1{font-size:20px;margin:0 0 8px}
            p{font-size:14px;line-height:1.5;color:#9FB2CC;margin:0 0 20px}
            button{background:#F4A300;color:#0B1F3A;border:0;border-radius:10px;
                   padding:12px 22px;font-size:15px;font-weight:600}
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Connection problem</h1>
            <p>We couldn't reach Falconova. Check your internet connection and try again.</p>
            <button onclick="location.href='${BuildConfigUrl.START_URL}'">Retry</button>
          </div>
        </body>
        </html>
    """.trimIndent()

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        binding.webView.restoreState(savedInstanceState)
    }

    override fun onPause() {
        super.onPause()
        binding.webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onDestroy() {
        binding.webView.destroy()
        super.onDestroy()
    }

    /**
     * Re-applies the system-bar and IME (keyboard) insets as padding on the
     * content layer. Because the window is edge-to-edge, without this the web
     * header would render under the status bar and the chat input would hide
     * behind the keyboard. The splash overlay is intentionally left full-bleed.
     */
    private fun applyWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.swipeRefresh) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    /** Fades/scales the logo in, then runs a gentle pulse until the page loads. */
    private fun startSplashAnimation() {
        val logo = binding.splashLogo
        logo.alpha = 0f
        logo.scaleX = 0.82f
        logo.scaleY = 0.82f
        logo.animate()
            .alpha(1f).scaleX(1f).scaleY(1f)
            .setDuration(480L)
            .setInterpolator(OvershootInterpolator(1.4f))
            .withEndAction { startLogoPulse() }
            .start()

        // Safety valve: never leave the user stuck on the splash if the page stalls.
        binding.root.postDelayed({ hideSplash() }, SPLASH_TIMEOUT_MS)
    }

    private fun startLogoPulse() {
        if (splashHidden) return
        binding.splashLogo.animate()
            .scaleX(1.06f).scaleY(1.06f)
            .setDuration(900L)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .withEndAction {
                if (splashHidden) return@withEndAction
                binding.splashLogo.animate()
                    .scaleX(1f).scaleY(1f)
                    .setDuration(900L)
                    .setInterpolator(AccelerateDecelerateInterpolator())
                    .withEndAction { startLogoPulse() }
                    .start()
            }
            .start()
    }

    /** Smoothly fades the animated splash overlay away exactly once. */
    private fun hideSplash() {
        if (splashHidden) return
        splashHidden = true
        binding.splashLogo.animate().cancel()
        binding.splashOverlay.animate()
            .alpha(0f)
            .setDuration(420L)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .withEndAction { binding.splashOverlay.visibility = View.GONE }
            .start()
    }

    /** Minimal JS→native bridge: the page reports whether it is scrolled to the top. */
    private inner class PullRefreshBridge {
        @android.webkit.JavascriptInterface
        fun setAtTop(atTop: Boolean) {
            contentAtTop = atTop
        }
    }

    companion object {
        // All subdomains of this host stay inside the app.
        private const val APP_HOST = "falconova.com"
        private const val SPLASH_TIMEOUT_MS = 9000L
        private const val JS_BRIDGE_NAME = "AndroidPull"

        // Window within which a second back press exits the app.
        private const val BACK_EXIT_WINDOW_MS = 2000L

        /**
         * Reports to native whether the page's active scroll container sits at the top.
         *
         * The dashboard scrolls a nested `overflow-y:auto` element rather than the
         * document, so native cannot observe it. A capture-phase `scroll` listener on
         * `document` sees those nested scrolls too, and `touchstart` refines which
         * container the finger is actually over. Idempotent: re-injection after an SPA
         * navigation is a no-op thanks to the install guard.
         */
        private val SCROLL_TRACKER_JS =
            """
            (function () {
              if (window.__omniPullRefreshInstalled) { return; }
              window.__omniPullRefreshInstalled = true;

              function report(atTop) {
                try { $JS_BRIDGE_NAME.setAtTop(!!atTop); } catch (e) {}
              }

              function isScrollable(el) {
                if (!el || el.nodeType !== 1) return false;
                if (el === document.body || el === document.documentElement) return false;
                var st = window.getComputedStyle(el);
                var oy = st.overflowY;
                if (oy !== 'auto' && oy !== 'scroll') return false;
                return el.scrollHeight > el.clientHeight + 1;
              }

              function scrollableAncestor(el) {
                while (el && el.nodeType === 1) {
                  if (isScrollable(el)) return el;
                  el = el.parentElement;
                }
                return null;
              }

              function docAtTop() {
                var d = document.scrollingElement || document.documentElement;
                return (window.pageYOffset || (d && d.scrollTop) || 0) <= 0;
              }

              // Source of truth: any scroll (including nested containers) updates the flag.
              document.addEventListener(
                'scroll',
                function (e) {
                  var t = e.target;
                  if (t && t.nodeType === 1 && isScrollable(t)) {
                    report(t.scrollTop <= 0);
                  } else {
                    report(docAtTop());
                  }
                },
                true
              );

              // Refine per-gesture: use the container under the finger.
              document.addEventListener(
                'touchstart',
                function (e) {
                  var touch = e.touches && e.touches[0];
                  var target = touch ? touch.target : e.target;
                  var sc = scrollableAncestor(target);
                  report(sc ? sc.scrollTop <= 0 : docAtTop());
                },
                true
              );

              report(docAtTop());
            })();
            """
    }
}
