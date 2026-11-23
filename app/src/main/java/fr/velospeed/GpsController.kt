package fr.velospeed

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** Position et vitesse GPS (fournisseur GPS du téléphone, sans service Google). */
@SuppressLint("MissingPermission")
class GpsController(
    ctx: Context,
    private val emit: (String, JSONObject) -> Unit
) {
    private val lm: LocationManager = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val main = Handler(Looper.getMainLooper())
    private var active = false

    // Toutes les méthodes sont implémentées : sur Android 10 et moins, les « défauts » n'existent pas.
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            emit("gps", toJson(location))
        }

        override fun onProviderEnabled(provider: String) {
            emit("gpsState", JSONObject().put("enabled", true))
        }

        override fun onProviderDisabled(provider: String) {
            emit("gpsState", JSONObject().put("enabled", false))
        }

        @Deprecated("Obsolète depuis Android 10")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {
        }
    }

    fun start() {
        main.post {
            if (active) return@post
            try {
                if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    // On s'abonne quand même : onProviderEnabled relancera le flux dès que le GPS est activé.
                    emit("gpsState", JSONObject().put("enabled", false))
                }
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 500L, 0f, listener, Looper.getMainLooper())
                active = true
                emit("gpsState", JSONObject().put("enabled", true).put("active", true))
            } catch (e: SecurityException) {
                emit("error", JSONObject().put("code", "permission").put("detail", "gps"))
            } catch (e: Exception) {
                emit("error", JSONObject().put("code", "gps_failed").put("detail", e.javaClass.simpleName))
            }
        }
    }

    fun stop() {
        main.post {
            if (!active) return@post
            try {
                lm.removeUpdates(listener)
            } catch (e: Exception) {
                // ignoré
            }
            active = false
            emit("gpsState", JSONObject().put("active", false))
        }
    }

    /** Dernière position connue (la plus récente parmi GPS, réseau, passif), ou null. */
    fun lastKnown(): JSONObject? {
        var best: Location? = null
        for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)) {
            val l = try {
                lm.getLastKnownLocation(p)
            } catch (e: Exception) {
                null
            }
            if (l != null && (best == null || l.time > best.time)) best = l
        }
        return best?.let { toJson(it) }
    }

    private fun num(v: Double): Any = if (v.isNaN() || v.isInfinite()) JSONObject.NULL else v

    private fun toJson(l: Location): JSONObject {
        val o = JSONObject()
        o.put("lat", num(l.latitude))
        o.put("lon", num(l.longitude))
        o.put("acc", if (l.hasAccuracy()) num(l.accuracy.toDouble()) else JSONObject.NULL)
        o.put("speed", if (l.hasSpeed()) num(l.speed.toDouble()) else JSONObject.NULL)
        o.put("alt", if (l.hasAltitude()) num(l.altitude) else JSONObject.NULL)
        o.put("time", l.time)
        return o
    }
}
