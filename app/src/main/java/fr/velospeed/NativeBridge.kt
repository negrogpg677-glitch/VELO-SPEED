package fr.velospeed

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject

/**
 * Pont entre l'interface (JavaScript) et Android. Seul le contenu local de l'appli
 * (file:///android_asset/www/) est chargé dans la WebView : aucune page externe n'a accès à ce pont.
 * Les méthodes @JavascriptInterface sont appelées sur un thread secondaire.
 */
class NativeBridge(private val act: MainActivity) {

    private val ble = BleController(act) { type, data -> emit(type, data) }
    private val gps = GpsController(act) { type, data -> emit(type, data) }

    companion object {
        const val REQ_BLE = 11
        const val REQ_LOCATION = 12
    }

    @Volatile private var closed = false

    fun emit(type: String, data: JSONObject) {
        if (closed) return
        act.runOnUiThread {
            if (closed || act.isDestroyed) return@runOnUiThread
            val js = "window.onNative&&window.onNative(" + JSONObject.quote(type) + "," + data.toString() + ")"
            act.web.evaluateJavascript(js, null)
        }
    }

    private fun has(p: String): Boolean = act.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun bleGranted(): Boolean =
        if (Build.VERSION.SDK_INT >= 31) has(Manifest.permission.BLUETOOTH_SCAN) && has(Manifest.permission.BLUETOOTH_CONNECT)
        else has(Manifest.permission.ACCESS_FINE_LOCATION)

    fun locationGranted(): Boolean = has(Manifest.permission.ACCESS_FINE_LOCATION)

    fun onPermissionResult(requestCode: Int, granted: Boolean) {
        val kind = if (requestCode == REQ_BLE) "ble" else "location"
        // « Ne plus demander » : Android ne réaffiche plus la fenêtre, seuls les réglages de l'appli peuvent aider.
        val perms = if (kind == "ble") {
            if (Build.VERSION.SDK_INT >= 31) listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
            else listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        } else listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        val blocked = !granted && perms.any { !has(it) && !act.shouldShowRequestPermissionRationale(it) }
        emit("perm", JSONObject().put("kind", kind).put("granted", granted).put("blocked", blocked))
    }

    fun shutdown() {
        closed = true
        ble.shutdown()
        gps.stop()
    }

    // ------------------------------------------------------------ Informations

    @JavascriptInterface
    fun getInfo(): String {
        val o = JSONObject()
        o.put("sdk", Build.VERSION.SDK_INT)
        o.put("android", Build.VERSION.RELEASE ?: "")
        o.put("model", (Build.MANUFACTURER ?: "") + " " + (Build.MODEL ?: ""))
        o.put("bleSupported", ble.isSupported())
        o.put("bleEnabled", ble.isEnabled())
        o.put("permBle", bleGranted())
        o.put("permLocation", locationGranted())
        o.put("locationEnabled", locationEnabled())
        o.put("bonded", bondedJson())
        o.put("appVersion", "2.0.0")
        return o.toString()
    }

    private fun locationEnabled(): Boolean = try {
        val lm = act.getSystemService(android.content.Context.LOCATION_SERVICE) as android.location.LocationManager
        if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled
        else lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER) ||
            lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)
    } catch (e: Exception) {
        true
    }

    /** Appareils déjà appairés dans les réglages Android, avec leur type (classique, LE ou double). */
    @android.annotation.SuppressLint("MissingPermission")
    private fun bondedJson(): org.json.JSONArray {
        val arr = org.json.JSONArray()
        try {
            if (Build.VERSION.SDK_INT >= 31 && !has(Manifest.permission.BLUETOOTH_CONNECT)) return arr
            val ad = (act.getSystemService(android.content.Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)?.adapter
            ad?.bondedDevices?.forEach {
                arr.put(JSONObject().put("name", it.name ?: "").put("address", it.address).put("type", it.type))
            }
        } catch (e: Exception) {
            // liste indisponible : on renvoie ce qu'on a
        }
        return arr
    }

    @JavascriptInterface
    fun lastLocation(): String {
        if (!locationGranted()) return "null"
        return gps.lastKnown()?.toString() ?: "null"
    }

    // ------------------------------------------------------------ Autorisations

    @JavascriptInterface
    fun requestPermissions(kind: String) {
        act.runOnUiThread {
            if (kind == "ble") {
                val perms = if (Build.VERSION.SDK_INT >= 31)
                    arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
                else
                    arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
                act.requestPermissions(perms, REQ_BLE)
            } else {
                act.requestPermissions(
                    arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                    REQ_LOCATION
                )
            }
        }
    }

    @JavascriptInterface
    fun openBluetoothSettings() {
        act.runOnUiThread {
            try {
                act.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
            } catch (e: Exception) {
                toast("Ouvre les réglages Bluetooth d'Android.")
            }
        }
    }

    @JavascriptInterface
    fun openAppSettings() {
        act.runOnUiThread {
            try {
                act.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", act.packageName, null))
                )
            } catch (e: Exception) {
                toast("Ouvrez Réglages > Applications > VELO SPEED > Autorisations.")
            }
        }
    }

    @JavascriptInterface
    fun bleRequestMtu(size: Int) = ble.requestMtu(size)

    @JavascriptInterface
    fun openLocationSettings() {
        act.runOnUiThread {
            try {
                act.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            } catch (e: Exception) {
                toast("Ouvre les réglages de localisation d'Android.")
            }
        }
    }

    @JavascriptInterface
    fun requestEnableBluetooth() {
        act.runOnUiThread {
            try {
                act.startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            } catch (e: Exception) {
                toast("Active le Bluetooth dans les réglages d'Android.")
            }
        }
    }

    // ------------------------------------------------------------ Bluetooth

    @JavascriptInterface
    fun bleStartScan() = ble.startScan()

    @JavascriptInterface
    fun bleStopScan() = ble.stopScan()

    @JavascriptInterface
    fun bleConnect(address: String) = ble.connect(address)

    @JavascriptInterface
    fun bleDisconnect() = ble.disconnect()

    @JavascriptInterface
    fun bleRead(service: String, char: String) = ble.read(service, char)

    @JavascriptInterface
    fun bleNotify(service: String, char: String, enable: Boolean) = ble.setNotify(service, char, enable)

    /** Autorise (ou non) la prochaine écriture. L'interface ne l'active que pendant une action confirmée. */
    @JavascriptInterface
    fun bleAllowWrites(allow: Boolean) {
        ble.writesAllowed = allow
    }

    @JavascriptInterface
    fun bleWriteHex(service: String, char: String, hex: String, withResponse: Boolean) =
        ble.writeHex(service, char, hex, withResponse)

    // ------------------------------------------------------------ GPS

    @JavascriptInterface
    fun gpsStart() = gps.start()

    @JavascriptInterface
    fun gpsStop() = gps.stop()

    // ------------------------------------------------------------ Divers

    @JavascriptInterface
    fun keepScreenOn(on: Boolean) {
        act.runOnUiThread {
            if (on) act.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else act.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    @JavascriptInterface
    fun toast(message: String) {
        act.runOnUiThread { Toast.makeText(act, message, Toast.LENGTH_SHORT).show() }
    }

    @JavascriptInterface
    fun copyText(text: String) {
        act.runOnUiThread {
            val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("VELO SPEED", text))
            Toast.makeText(act, "Copié dans le presse-papiers", Toast.LENGTH_SHORT).show()
        }
    }

    /** Partage un texte (journal, CSV, GPX…) via la feuille de partage d'Android. */
    @JavascriptInterface
    fun shareText(title: String, text: String) {
        act.runOnUiThread {
            val body = if (text.length > 400_000) text.substring(0, 400_000) + "\n[tronqué]" else text
            val send = Intent(Intent.ACTION_SEND)
            send.type = "text/plain"
            send.putExtra(Intent.EXTRA_SUBJECT, title)
            send.putExtra(Intent.EXTRA_TEXT, body)
            try {
                act.startActivity(Intent.createChooser(send, title))
            } catch (e: Exception) {
                toast("Partage impossible sur ce téléphone.")
            }
        }
    }
}
