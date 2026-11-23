package fr.velospeed

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

    lateinit var web: WebView
        private set
    private lateinit var bridge: NativeBridge

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true)

        web = WebView(this)
        setContentView(web)

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = true
        s.allowContentAccess = false
        s.mediaPlaybackRequiresUserGesture = true
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.textZoom = 100
        web.overScrollMode = WebView.OVER_SCROLL_NEVER

        // Seules les pages locales de l'appli restent dans la WebView ; tout le reste est bloqué.
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return !request.url.toString().startsWith("file:///android_asset/")
            }

            @Suppress("OVERRIDE_DEPRECATION")
            @Deprecated("API 23 : ancienne signature")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                !url.startsWith("file:///android_asset/")
        }
        web.webChromeClient = WebChromeClient()

        bridge = NativeBridge(this)
        web.addJavascriptInterface(bridge, "Native")
        web.loadUrl("file:///android_asset/www/index.html")
    }

    @Deprecated("Géré à la main pour la navigation interne")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.nativeBack?window.nativeBack():false)") { r ->
            if (r != "true") finish()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.isEmpty()) return // demande interrompue : rien à signaler
        val ok = if (requestCode == NativeBridge.REQ_LOCATION) bridge.locationGranted()
        else grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        // Pour la localisation, la permission « précise » seule suffit : on relit l'état réel côté JS.
        bridge.onPermissionResult(requestCode, ok)
    }

    override fun onDestroy() {
        if (::bridge.isInitialized) bridge.shutdown()
        web.removeJavascriptInterface("Native")
        web.destroy()
        super.onDestroy()
    }
}
