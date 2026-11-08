package com.fuelfinder.androidautonavigation

import android.content.Intent
import android.net.Uri
import android.text.SpannableString
import android.text.Spanned
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.CarLocation
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.Metadata
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import com.margelo.nitro.swe.iternio.reactnativeautoplay.AndroidAutoSession
import com.margelo.nitro.swe.iternio.reactnativeautoplay.AndroidAutoScreen
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

class AndroidAutoNavigationModule : Module() {
  companion object {
    private const val TAG = "FuelFinderNavigation"
  }

  private data class Station(
    val name: String,
    val details: String,
    val latitude: Double,
    val longitude: Double,
    val distanceMiles: Double,
  )

  private class FuelFinderPoiScreen(
    carContext: CarContext,
    private val stations: List<Station>,
    private val anchorLatitude: Double,
    private val anchorLongitude: Double,
    private val hasCurrentLocation: Boolean,
    private val radiusMiles: Double,
  ) : Screen(carContext) {
    override fun onGetTemplate() = PlaceListMapTemplate.Builder()
      .setTitle("Fuel stations within ${radiusMiles.toInt()} mi")
      .setAnchor(
        Place.Builder(CarLocation.create(anchorLatitude, anchorLongitude))
          .setMarker(
            PlaceMarker.Builder()
              .setLabel(if (hasCurrentLocation) "You" else "Def")
              .build()
          )
          .build()
      )
      .setCurrentLocationEnabled(hasCurrentLocation)
      .setItemList(
        ItemList.Builder().apply {
          stations.take(6).forEach { station ->
            val place = Place.Builder(
              CarLocation.create(station.latitude, station.longitude)
            ).setMarker(
              PlaceMarker.Builder()
                .setLabel("F")
                .build()
            ).build()

            addItem(
              Row.Builder()
                .setTitle(station.name)
                .addText(
                  SpannableString(" ").apply {
                    setSpan(
                      DistanceSpan.create(
                        Distance.create(station.distanceMiles, Distance.UNIT_MILES_P1)
                      ),
                      0,
                      1,
                      Spanned.SPAN_INCLUSIVE_INCLUSIVE,
                    )
                  }
                )
                .addText(station.details)
                .setMetadata(Metadata.Builder().setPlace(place).build())
                .setOnClickListener {
                  val destinationName = Uri.encode(station.name)
                  val navUri = Uri.parse(
                    "geo:0,0?q=${station.latitude},${station.longitude}($destinationName)"
                  )
                  val intent = Intent(CarContext.ACTION_NAVIGATE, navUri)

                  Log.i(
                    TAG,
                    "Selected POI station: ${station.name}; " +
                      "requesting host navigation handoff uri=$navUri"
                  )
                  try {
                    carContext.startCarApp(intent)
                  } catch (e: Exception) {
                    Log.e(TAG, "Failed to request host navigation handoff", e)
                  }
                }
                .build()
            )
          }
          if (stations.isEmpty()) {
            setNoItemsMessage("No nearby stations found")
          }
        }.build()
      )
      .build()
  }

  override fun definition() = ModuleDefinition {
    Name("AndroidAutoNavigation")

    AsyncFunction("showStations") {
        stationsJson: String,
        anchorLatitude: Double,
        anchorLongitude: Double,
        hasCurrentLocation: Boolean,
        radiusMiles: Double,
      ->
      require(anchorLatitude.isFinite() && anchorLatitude in -90.0..90.0) {
        "Anchor latitude must be between -90 and 90."
      }
      require(anchorLongitude.isFinite() && anchorLongitude in -180.0..180.0) {
        "Anchor longitude must be between -180 and 180."
      }
      require(radiusMiles.isFinite() && radiusMiles > 0.0 && radiusMiles <= 100.0) {
        "Search radius must be greater than 0 and no more than 100 miles."
      }
      val stations = JSONArray(stationsJson).let { array ->
        (0 until array.length()).map { index ->
          val station = array.getJSONObject(index)
          val latitude = station.getDouble("latitude")
          val longitude = station.getDouble("longitude")
          require(latitude.isFinite() && latitude in -90.0..90.0) {
            "Latitude must be between -90 and 90."
          }
          require(longitude.isFinite() && longitude in -180.0..180.0) {
            "Longitude must be between -180 and 180."
          }
          val distanceMiles = station.optDouble("distanceMiles", 0.0)
          require(distanceMiles.isFinite() && distanceMiles >= 0.0) {
            "Distance must be a non-negative number of miles."
          }
          Station(
            name = station.getString("name"),
            details = station.optString("details"),
            latitude = latitude,
            longitude = longitude,
            distanceMiles = distanceMiles,
          )
        }
      }

      val carContext: CarContext = AndroidAutoSession.getRootContext()
        ?: throw IllegalStateException("Android Auto is not connected.")
      val screenManager = AndroidAutoScreen.getScreenManager()
        ?: throw IllegalStateException("Android Auto screen manager is unavailable.")
      val previousRoot = screenManager.top
      screenManager.push(
        FuelFinderPoiScreen(
          carContext,
          stations,
          anchorLatitude,
          anchorLongitude,
          hasCurrentLocation,
          radiusMiles,
        )
      )
      screenManager.remove(previousRoot)
      Log.i(
        TAG,
        "Displayed POI map with ${stations.size.coerceAtMost(6)} stations; " +
          "anchor=$anchorLatitude,$anchorLongitude hasCurrentLocation=$hasCurrentLocation " +
          "radiusMiles=$radiusMiles"
      )
    }.runOnQueue(Queues.MAIN)
  }
}
