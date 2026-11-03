package __APP_PACKAGE__.car

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarLocation
import androidx.car.app.model.CarText
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.Metadata
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.validation.HostValidator
import __APP_PACKAGE__.BuildConfig
import __APP_PACKAGE__.R
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.concurrent.thread

private data class FuelStation(
    val name: String,
    val address: String,
    val latitude: Double,
    val longitude: Double,
    val distanceMiles: Double,
    val bestPrice: String,
)

class FuelFinderCarAppService : CarAppService() {
    override fun createHostValidator(): HostValidator =
        if (BuildConfig.DEBUG) HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        else HostValidator.Builder(this).addAllowedHosts(R.array.fuel_finder_car_host_signatures).build()

    override fun onCreateSession(): Session = object : Session() {
        override fun onCreateScreen(intent: Intent): Screen = NearbyFuelStationsScreen(carContext)
    }
}

private class NearbyFuelStationsScreen(carContext: CarContext) : Screen(carContext) {
    private var stations: List<FuelStation> = emptyList()
    private var loading = true
    private var message = ""
    private var requestStarted = false

    override fun onGetTemplate(): PlaceListMapTemplate {
        val builder = PlaceListMapTemplate.Builder()
            .setTitle("Nearby fuel")
            .setHeaderAction(Action.APP_ICON)
            .setCurrentLocationEnabled(hasLocationPermission())
            .setOnContentRefreshListener {
            loadStations()
            invalidate()
        }
        if (loading) builder.setLoading(true) else builder.setItemList(buildItemList())
        return builder.build()
    }

    override fun onStart() {
        super.onStart()
        if (!requestStarted) loadStations()
    }

    private fun hasLocationPermission(): Boolean =
        carContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || carContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun buildItemList(): ItemList {
        val builder = ItemList.Builder()
        stations.forEach { station ->
            val distance = Distance.create(station.distanceMiles, Distance.UNIT_MILES_P1)
            val distanceText = SpannableString(" ")
            distanceText.setSpan(DistanceSpan.create(distance), 0, distanceText.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
            val subtitle = if (station.bestPrice.isBlank()) station.address else "${station.bestPrice} · ${station.address}"
            val marker = PlaceMarker.Builder()
                .setLabel("£")
                .setColor(CarColor.createRGB(23, 107, 77))
                .build()
            val place = Place.Builder(CarLocation.create(station.latitude, station.longitude))
                .setMarker(marker)
                .build()
            builder.addItem(
                Row.Builder()
                    .setTitle(station.name)
                    .addText(distanceText)
                    .addText(subtitle.ifBlank { "Fuel station" })
                    .setMetadata(Metadata.Builder().setPlace(place).build())
                    .setOnClickListener { openNavigation(station) }
                    .build(),
            )
        }
        if (stations.isEmpty() && !loading) {
            val emptyText = if (message.isBlank()) "No nearby stations found" else message
            builder.setNoItemsMessage(emptyText)
        }
        return builder.build()
    }

    private fun openNavigation(station: FuelStation) {
        val destination = Uri.encode("${station.latitude},${station.longitude}")
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$destination"))
            .setPackage("com.google.android.apps.maps")
        try {
            carContext.startCarApp(intent)
        } catch (_: Exception) {
            message = "Google Maps is not available on this phone"
            invalidate()
        }
    }

    private fun loadStations() {
        if (requestStarted) return
        requestStarted = true
        loading = true
        message = ""
        invalidate()
        thread(name = "fuel-finder-car-search") {
            try {
                if (!hasLocationPermission()) throw IllegalStateException("Open Fuel Finder on your phone and allow location access first")
                val location = lastKnownLocation()
                    ?: throw IllegalStateException("Waiting for a location fix. Open Fuel Finder on your phone, then refresh.")
                stations = fetchStations(location)
                if (stations.isEmpty()) message = "No stations found within 5 miles"
            } catch (error: Exception) {
                message = error.message ?: "Could not load nearby stations"
            } finally {
                loading = false
                requestStarted = false
                Handler(Looper.getMainLooper()).post { invalidate() }
            }
        }
    }

    private fun lastKnownLocation(): Location? {
        val manager = carContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
            .mapNotNull { provider ->
                try {
                    manager.getLastKnownLocation(provider)
                } catch (_: SecurityException) {
                    null
                } catch (_: IllegalArgumentException) {
                    null
                }
            }
            .maxByOrNull { it.time }
    }

    private fun fetchStations(location: Location): List<FuelStation> {
        val metadata = carContext.packageManager.getApplicationInfo(
            carContext.packageName,
            PackageManager.GET_META_DATA,
        ).metaData
        val baseUrl = metadata?.getString("com.fuelfinder.API_BASE_URL")?.trimEnd('/')
            ?: "http://localhost:3000"
        val query = "latitude=${location.latitude}&longitude=${location.longitude}&miles=5&sort=closest&limit=20"
        val connection = URL("$baseUrl/api/stations/search?$query").openConnection() as HttpURLConnection
        connection.connectTimeout = 7000
        connection.readTimeout = 7000
        connection.setRequestProperty("Accept", "application/json")
        return try {
            val status = connection.responseCode
            val bodyStream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = bodyStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val detail = runCatching { JSONObject(response).optString("error") }.getOrNull().orEmpty()
                throw IllegalStateException(detail.ifBlank { "Station search failed ($status)" })
            }
            val stationArray = JSONObject(response).optJSONArray("stations") ?: return emptyList()
            (0 until stationArray.length()).mapNotNull { index ->
                val value = stationArray.optJSONObject(index) ?: return@mapNotNull null
                val nestedLocation = value.optJSONObject("location")
                val latitude = value.optDouble("latitude", nestedLocation?.optDouble("latitude", Double.NaN) ?: Double.NaN)
                val longitude = value.optDouble("longitude", nestedLocation?.optDouble("longitude", Double.NaN) ?: Double.NaN)
                if (!latitude.isFinite() || !longitude.isFinite()) return@mapNotNull null
                FuelStation(
                    name = value.optString("tradingName", value.optString("trading_name", value.optString("name", "Fuel station"))),
                    address = value.optString("postcode", value.optString("brandName", "")),
                    latitude = latitude,
                    longitude = longitude,
                    distanceMiles = value.optDouble("distanceMiles", 0.0).coerceAtLeast(0.0),
                    bestPrice = bestPrice(value),
                )
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun bestPrice(station: JSONObject): String {
        val matchedPrice = station.optJSONObject("matchedPrice")
        if (matchedPrice != null && matchedPrice.has("price")) {
            val product = matchedPrice.optString("product", "Fuel")
            return "$product ${matchedPrice.optDouble("price").let { String.format(Locale.UK, "%.1fp", it) }}"
        }
        var lowest: Pair<String, Double>? = null
        val groups = station.optJSONArray("fuelPrices") ?: return ""
        for (groupIndex in 0 until groups.length()) {
            val group = groups.optJSONObject(groupIndex) ?: continue
            val prices = group.optJSONArray("fuel_prices") ?: group.optJSONArray("fuelPrices")
                ?: org.json.JSONArray().put(group)
            for (priceIndex in 0 until prices.length()) {
                val item = prices.optJSONObject(priceIndex) ?: continue
                val price = item.optDouble("price", Double.NaN)
                if (price.isFinite() && (lowest == null || price < lowest!!.second)) {
                    lowest = item.optString("fuel_type", item.optString("fuelType", "Fuel")) to price
                }
            }
        }
        return lowest?.let { "${it.first} ${String.format(Locale.UK, "%.1fp", it.second)}" } ?: ""
    }
}