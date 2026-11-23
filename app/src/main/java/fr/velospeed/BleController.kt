package fr.velospeed

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.UUID

/**
 * Moteur Bluetooth Low Energy (GATT). Il ne connaît AUCUN protocole propre à un vélo :
 * il scanne, se connecte, liste les services, lit, écoute les notifications et (si l'interface
 * l'autorise explicitement) écrit des octets. Tout se passe sur le thread principal ; les
 * opérations GATT sont mises en file, car Android n'en accepte qu'une à la fois.
 */
@SuppressLint("MissingPermission")
class BleController(
    private val ctx: Context,
    private val emit: (String, JSONObject) -> Unit
) {
    private class Op(val name: String, val meta: JSONObject, val run: () -> Boolean)

    private val main = Handler(Looper.getMainLooper())
    private val manager: BluetoothManager? =
        ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val adapter: BluetoothAdapter? get() = manager?.adapter

    private var gatt: BluetoothGatt? = null
    private var connected = false
    private var scanCallback: ScanCallback? = null
    private var scanning = false

    private val ops = ArrayDeque<Op>()
    private var current: Op? = null

    /** Garde-fou : les écritures ne sont acceptées que si l'interface vient de les autoriser. */
    @Volatile
    var writesAllowed: Boolean = false

    private val cccd: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private val stopScanRunnable = Runnable { stopScan() }
    private val connectTimeoutRunnable = Runnable {
        if (!connected && gatt != null) {
            closeGatt()
            if (!retried && !userDisconnect && lastAddress.isNotEmpty()) {
                // Délai dépassé : une seule nouvelle tentative, comme pour l'erreur 133.
                retried = true
                err("retry_133", "délai")
                retryAddr = lastAddress
                main.postDelayed(retryRunnable, 1000L)
            } else {
                emit("conn", JSONObject().put("state", "failed").put("status", -1))
            }
        }
    }
    private val opWatchdog = Runnable {
        val op = current
        if (op != null && op.name == "mtu") {
            // Android ne rappelle pas toujours quand le MTU est déjà négocié : on n'abandonne pas la liaison pour ça.
            emit("error", JSONObject().put("code", "mtu_timeout").put("detail", ""))
            finishOp()
        } else if (op != null) {
            emit("error", JSONObject().put("code", "op_timeout").put("detail", op.name))
            // Android garde la pile « occupée » tant qu'un retour manque : on repart d'une liaison propre.
            val addr = gatt?.device?.address ?: ""
            closeGatt()
            emit("conn", JSONObject().put("state", "disconnected").put("status", -4).put("address", addr))
        }
    }

    // ------------------------------------------------------------------ État

    fun isSupported(): Boolean =
        ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) && adapter != null

    fun isEnabled(): Boolean = try {
        adapter?.isEnabled == true
    } catch (e: SecurityException) {
        false
    }

    // ------------------------------------------------------------------ Scan

    fun startScan() {
        main.post {
            val ad = adapter
            if (ad == null || !isEnabled()) {
                err("bt_off", "")
                return@post
            }
            if (Build.VERSION.SDK_INT < 31) {
                val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                val on = if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled
                else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                if (!on) {
                    err("location_off", "")
                    return@post
                }
            }
            val scanner = ad.bluetoothLeScanner
            if (scanner == null) {
                err("scanner_null", "")
                return@post
            }
            stopScanInternal()
            val cb = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    reportScan(result)
                }

                override fun onBatchScanResults(results: MutableList<ScanResult>) {
                    for (r in results) reportScan(r)
                }

                override fun onScanFailed(errorCode: Int) {
                    scanning = false
                    scanCallback = null
                    err("scan_failed", errorCode.toString())
                    emit("scanState", JSONObject().put("scanning", false))
                }
            }
            try {
                val settings = ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .build()
                scanner.startScan(null, settings, cb)
                scanCallback = cb
                scanning = true
                emit("scanState", JSONObject().put("scanning", true))
                main.removeCallbacks(stopScanRunnable)
                main.postDelayed(stopScanRunnable, 20000L)
            } catch (e: SecurityException) {
                err("permission", "scan")
            } catch (e: Exception) {
                err("scan_failed", e.javaClass.simpleName)
            }
        }
    }

    fun stopScan() {
        main.post { stopScanInternal() }
    }

    private fun stopScanInternal() {
        main.removeCallbacks(stopScanRunnable)
        val cb = scanCallback
        if (cb != null) {
            try {
                adapter?.bluetoothLeScanner?.stopScan(cb)
            } catch (e: Exception) {
                // adaptateur coupé ou permission retirée : rien à faire
            }
        }
        scanCallback = null
        if (scanning) {
            scanning = false
            emit("scanState", JSONObject().put("scanning", false))
        }
    }

    private fun reportScan(r: ScanResult) {
        val dev = r.device
        val rec = r.scanRecord
        var name: String? = rec?.deviceName
        if (name == null) {
            name = try {
                dev.name
            } catch (e: SecurityException) {
                null
            }
        }
        val o = JSONObject()
        o.put("name", name ?: "")
        o.put("address", dev.address)
        o.put("rssi", r.rssi)
        o.put("connectable", if (Build.VERSION.SDK_INT >= 26) r.isConnectable else true)
        try {
            o.put("type", dev.type)      // 1 = classique, 2 = LE, 3 = double mode, 0 = inconnu
            o.put("bond", dev.bondState) // 10 = non appairé, 11 = en cours, 12 = appairé
        } catch (e: SecurityException) {
            o.put("type", 0).put("bond", 10)
        }
        val uuids = JSONArray()
        rec?.serviceUuids?.forEach { uuids.put(it.toString().lowercase()) }
        o.put("services", uuids)
        o.put("adv", hex(rec?.bytes ?: ByteArray(0)))
        emit("scan", o)
    }

    // ------------------------------------------------------------------ Connexion

    private var lastAddress: String = ""
    private var retried = false
    private var retryAddr: String? = null
    private val retryRunnable = Runnable {
        val a = retryAddr
        retryAddr = null
        if (a != null && gatt == null && !userDisconnect) connectInternal(a)
    }

    fun connect(address: String) {
        retried = false
        userDisconnect = false
        connectInternal(address)
    }

    private fun connectInternal(address: String) {
        main.post {
            lastAddress = address
            stopScanInternal()
            closeGatt()
            val ad = adapter
            if (ad == null) {
                err("bt_off", "")
                return@post
            }
            val dev: BluetoothDevice = try {
                ad.getRemoteDevice(address)
            } catch (e: IllegalArgumentException) {
                err("bad_address", address)
                return@post
            }
            emit("conn", JSONObject().put("state", "connecting").put("address", address))
            try {
                gatt = dev.connectGatt(ctx, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
                main.removeCallbacks(connectTimeoutRunnable)
                main.postDelayed(connectTimeoutRunnable, 20000L)
            } catch (e: SecurityException) {
                err("permission", "connect")
                emit("conn", JSONObject().put("state", "failed").put("status", -2))
            }
        }
    }

    @Volatile private var userDisconnect = false

    fun disconnect() {
        userDisconnect = true
        main.post {
            if (retryAddr != null) {
                // Annulation pendant le court délai avant la nouvelle tentative.
                main.removeCallbacks(retryRunnable)
                retryAddr = null
                emit("conn", JSONObject().put("state", "disconnected").put("status", 0))
                return@post
            }
            val g = gatt ?: return@post
            try {
                g.disconnect()
            } catch (e: Exception) {
                // ignoré
            }
            main.postDelayed({
                if (gatt === g) {
                    closeGatt()
                    emit("conn", JSONObject().put("state", "disconnected").put("status", 0))
                }
            }, 2500L)
        }
    }

    fun shutdown() {
        userDisconnect = true
        main.post {
            stopScanInternal()
            closeGatt()
        }
    }

    private fun closeGatt() {
        main.removeCallbacks(retryRunnable)
        retryAddr = null
        main.removeCallbacks(connectTimeoutRunnable)
        main.removeCallbacks(opWatchdog)
        val g = gatt
        gatt = null
        connected = false
        writesAllowed = false
        ops.clear()
        current = null
        if (g != null) {
            try {
                g.disconnect()
            } catch (e: Exception) {
                // ignoré
            }
            try {
                g.close()
            } catch (e: Exception) {
                // ignoré
            }
        }
    }

    private fun nameOf(d: BluetoothDevice): String = try {
        d.name ?: ""
    } catch (e: SecurityException) {
        ""
    }

    private val gattCallback = object : BluetoothGattCallback() {

        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            main.post {
                if (g !== gatt) {
                    try {
                        g.close()
                    } catch (e: Exception) {
                        // ignoré
                    }
                    return@post
                }
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    connected = true
                    main.removeCallbacks(connectTimeoutRunnable)
                    var bondState = 10
                    var devType = 0
                    try {
                        bondState = g.device.bondState
                        devType = g.device.type
                    } catch (e: SecurityException) {
                        // laissé aux valeurs par défaut
                    }
                    emit(
                        "conn",
                        JSONObject().put("state", "connected")
                            .put("name", nameOf(g.device)).put("address", g.device.address)
                            .put("bond", bondState).put("type", devType)
                    )
                    // Petit délai avant la découverte : plus fiable sur beaucoup de téléphones.
                    main.postDelayed({
                        if (gatt === g) {
                            try {
                                if (!g.discoverServices()) {
                                    err("discover_failed", "refused")
                                    closeGatt()
                                    emit("conn", JSONObject().put("state", "failed").put("status", -3))
                                }
                            } catch (e: SecurityException) {
                                err("permission", "discover")
                            }
                        }
                    }, 600L)
                } else {
                    val wasConnected = connected
                    val addr = g.device.address
                    closeGatt()
                    // Erreur 133 à la première tentative : très fréquente avec les contrôleurs bon marché,
                    // elle disparaît souvent à la deuxième. Une seule nouvelle tentative, signalée dans le journal.
                    if (!wasConnected && status == 133 && !retried && !userDisconnect) {
                        retried = true
                        err("retry_133", "")
                        retryAddr = addr
                        main.postDelayed(retryRunnable, 1000L)
                        return@post
                    }
                    emit(
                        "conn",
                        JSONObject().put("state", if (wasConnected) "disconnected" else "failed")
                            .put("status", status).put("address", addr)
                    )
                }
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            main.post {
                if (g !== gatt) return@post
                emit("mtu", JSONObject().put("mtu", mtu).put("status", status))
                if (current?.name == "mtu") finishOp()
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            main.post {
                if (g !== gatt) return@post
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    err("discover_failed", status.toString())
                    return@post
                }
                val arr = JSONArray()
                for (s in g.services) {
                    val so = JSONObject().put("uuid", s.uuid.toString().lowercase())
                    val cs = JSONArray()
                    for (c in s.characteristics) {
                        val p = c.properties
                        val props = JSONArray()
                        if ((p and BluetoothGattCharacteristic.PROPERTY_READ) != 0) props.put("read")
                        if ((p and BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) props.put("write")
                        if ((p and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) props.put("writeNoResponse")
                        if ((p and BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) props.put("notify")
                        if ((p and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) props.put("indicate")
                        cs.put(JSONObject().put("uuid", c.uuid.toString().lowercase()).put("props", props))
                    }
                    so.put("characteristics", cs)
                    arr.put(so)
                }
                emit("services", JSONObject().put("services", arr))
            }
        }

        // --- Lecture (ancienne et nouvelle signatures ; une seule est active selon la version d'Android)
        @Deprecated("Remplacé par la version avec valeur (Android 13+)")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (Build.VERSION.SDK_INT < 33) handleRead(g, c, c.value ?: ByteArray(0), status)
        }

        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
            handleRead(g, c, value, status)
        }

        // --- Notifications
        @Deprecated("Remplacé par la version avec valeur (Android 13+)")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33) handleChanged(g, c, c.value ?: ByteArray(0))
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            handleChanged(g, c, value)
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            main.post {
                if (g !== gatt) return@post
                emit(
                    "writeResult",
                    JSONObject().put("service", c.service.uuid.toString().lowercase())
                        .put("char", c.uuid.toString().lowercase()).put("status", status)
                )
                if (current?.name == "write") finishOp()
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            main.post {
                if (g !== gatt) return@post
                val meta = current?.meta ?: JSONObject()
                emit("notifyState", JSONObject(meta.toString()).put("status", status))
                if (current?.name == "notify") finishOp()
            }
        }
    }

    private fun handleRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
        val copy = value.copyOf()
        main.post {
            if (g !== gatt) return@post
            if (status == BluetoothGatt.GATT_SUCCESS) {
                emit("value", valueJson(c, copy, "read"))
            } else {
                err("read_failed", status.toString())
            }
            if (current?.name == "read") finishOp()
        }
    }

    private fun handleChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
        val copy = value.copyOf()
        main.post {
            if (g !== gatt) return@post
            emit("value", valueJson(c, copy, "notify"))
        }
    }

    private fun valueJson(c: BluetoothGattCharacteristic, v: ByteArray, kind: String): JSONObject =
        JSONObject().put("service", c.service.uuid.toString().lowercase())
            .put("char", c.uuid.toString().lowercase())
            .put("hex", hex(v)).put("kind", kind)

    // ------------------------------------------------------------------ Opérations GATT en file

    private fun enqueue(name: String, meta: JSONObject, run: () -> Boolean) {
        ops.add(Op(name, meta, run))
        pump()
    }

    private fun pump() {
        if (current != null) return
        val op = ops.poll() ?: return
        current = op
        main.removeCallbacks(opWatchdog)
        main.postDelayed(opWatchdog, 6000L)
        val ok = try {
            op.run()
        } catch (e: SecurityException) {
            err("permission", op.name)
            false
        } catch (e: Exception) {
            err("op_failed", op.name)
            false
        }
        if (!ok) {
            err("op_refused", op.name)
            finishOp()
        }
    }

    private fun finishOp() {
        main.removeCallbacks(opWatchdog)
        current = null
        pump()
    }

    private fun find(svc: String, chr: String): BluetoothGattCharacteristic? {
        val g = gatt ?: return null
        return try {
            g.getService(UUID.fromString(svc))?.getCharacteristic(UUID.fromString(chr))
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    /** Demande une taille de paquet ATT plus grande (diagnostic). Le vélo peut la refuser : le résultat est signalé. */
    fun requestMtu(size: Int) {
        main.post {
            val n = size.coerceIn(23, 517)
            enqueue("mtu", JSONObject()) { gatt?.requestMtu(n) ?: false }
        }
    }

    fun read(svc: String, chr: String) {
        main.post {
            enqueue("read", JSONObject()) {
                val g = gatt
                val c = find(svc, chr)
                if (g == null || c == null) false else g.readCharacteristic(c)
            }
        }
    }

    @Suppress("DEPRECATION")
    fun setNotify(svc: String, chr: String, enable: Boolean) {
        main.post {
            val meta = JSONObject().put("service", svc).put("char", chr).put("enabled", enable)
            enqueue("notify", meta) {
                val g = gatt
                val c = find(svc, chr)
                if (g == null || c == null) return@enqueue false
                val props = c.properties
                val indicate = (props and BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0 &&
                    (props and BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0
                if (!g.setCharacteristicNotification(c, enable)) return@enqueue false
                val d = c.getDescriptor(cccd) ?: return@enqueue false
                val v = when {
                    !enable -> BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
                    indicate -> BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                    else -> BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                }
                if (Build.VERSION.SDK_INT >= 33) {
                    g.writeDescriptor(d, v) == 0
                } else {
                    d.value = v
                    g.writeDescriptor(d)
                }
            }
        }
    }

    @Suppress("DEPRECATION")
    fun writeHex(svc: String, chr: String, hexString: String, withResponse: Boolean) {
        // Autorisation évaluée à l'instant de l'appel (thread de l'interface), pas plus tard.
        val allowed = writesAllowed
        main.post {
            if (!allowed) {
                err("write_blocked", "")
                return@post
            }
            val bytes = try {
                parseHex(hexString)
            } catch (e: Exception) {
                err("bad_hex", "")
                return@post
            }
            if (bytes.isEmpty() || bytes.size > 100) {
                err("bad_hex", "taille")
                return@post
            }
            enqueue("write", JSONObject()) {
                val g = gatt
                val c = find(svc, chr)
                if (g == null || c == null) return@enqueue false
                val type = if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                if (Build.VERSION.SDK_INT >= 33) {
                    g.writeCharacteristic(c, bytes, type) == 0
                } else {
                    c.writeType = type
                    c.value = bytes
                    g.writeCharacteristic(c)
                }
            }
        }
    }

    // ------------------------------------------------------------------ Outils

    private fun err(code: String, detail: String) {
        emit("error", JSONObject().put("code", code).put("detail", detail))
    }

    private fun hex(b: ByteArray): String {
        val sb = StringBuilder(b.size * 2)
        for (x in b) {
            val v = x.toInt() and 0xFF
            sb.append("0123456789abcdef"[v shr 4]).append("0123456789abcdef"[v and 15])
        }
        return sb.toString()
    }

    private fun parseHex(s: String): ByteArray {
        val t = s.filter { it.isLetterOrDigit() }
        require(t.length % 2 == 0)
        val out = ByteArray(t.length / 2)
        for (i in out.indices) out[i] = t.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        return out
    }
}
