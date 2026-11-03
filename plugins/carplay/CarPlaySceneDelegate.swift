import CarPlay
import CoreLocation
import MapKit
import UIKit

private struct FuelStation: Decodable {
  let name: String
  let address: String
  let latitude: Double
  let longitude: Double
  let distanceMiles: Double
  let bestPrice: String

  enum CodingKeys: String, CodingKey {
    case name = "tradingName"
    case address
    case postcode
    case brandName
    case latitude
    case longitude
    case location
    case distanceMiles
    case matchedPrice
    case fuelPrices
  }

  private struct Coordinates: Decodable {
    let latitude: Double?
    let longitude: Double?
  }

  private struct MatchedPrice: Decodable {
    let product: String?
    let price: Double?
  }

  private struct PriceRecord: Decodable {
    let fuelType: String?
    let fuel: String?
    let price: Double?

    enum CodingKeys: String, CodingKey {
      case fuelType = "fuel_type"
      case fuel
      case price
    }
  }

  private struct PriceGroup: Decodable {
    let fuelPrices: [PriceRecord]?

    enum CodingKeys: String, CodingKey {
      case fuelPrices = "fuel_prices"
    }
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    let location = try? values.decode(Coordinates.self, forKey: .location)
    name = (try? values.decode(String.self, forKey: .name)) ?? "Fuel station"
    address = (try? values.decode(String.self, forKey: .address))
      ?? (try? values.decode(String.self, forKey: .postcode))
      ?? (try? values.decode(String.self, forKey: .brandName))
      ?? ""
    latitude = (try? values.decode(Double.self, forKey: .latitude)) ?? location?.latitude ?? 0
    longitude = (try? values.decode(Double.self, forKey: .longitude)) ?? location?.longitude ?? 0
    distanceMiles = (try? values.decode(Double.self, forKey: .distanceMiles)) ?? 0
    if let match = try? values.decode(MatchedPrice.self, forKey: .matchedPrice),
       let amount = match.price {
      bestPrice = "\(match.product ?? "Fuel") \(String(format: "%.1fp", amount))"
    } else {
      let groups = (try? values.decode([PriceGroup].self, forKey: .fuelPrices)) ?? []
      let prices = groups.flatMap { $0.fuelPrices ?? [] }.compactMap { record -> (String, Double)? in
        guard let amount = record.price else { return nil }
        return (record.fuelType ?? record.fuel ?? "Fuel", amount)
      }
      if let lowest = prices.min(by: { $0.1 < $1.1 }) {
        bestPrice = "\(lowest.0) \(String(format: "%.1fp", lowest.1))"
      } else {
        bestPrice = ""
      }
    }
  }
}

private struct StationSearchResponse: Decodable {
  let stations: [FuelStation]
}

final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate, CLLocationManagerDelegate, CPMapTemplateDelegate {
  private let locationManager = CLLocationManager()
  private let mapView = MKMapView(frame: .zero)
  private let mapTemplate = CPMapTemplate()
  private weak var interfaceController: CPInterfaceController?
  private var stations: [FuelStation] = []
  private var currentLocation: CLLocation?
  private var activeRoute: MKRoute?
  private var activeTrip: CPTrip?
  private var navigationSession: CPNavigationSession?
  private var maneuverLocations: [CLLocation] = []
  private var activeManeuverIndex = 0

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController,
    to window: CPWindow
  ) {
    self.interfaceController = interfaceController
    mapView.delegate = self
    mapView.showsUserLocation = true
    mapView.isPitchEnabled = false
    mapView.isRotateEnabled = false
    mapView.isScrollEnabled = false
    mapView.isZoomEnabled = false
    window.rootViewController = UIViewController()
    window.rootViewController?.view = mapView
    mapTemplate.mapDelegate = self
    mapTemplate.leadingNavigationBarButtons = [
      CPBarButton(title: "Stations") { [weak self] _ in self?.showStations() },
    ]
    interfaceController.setRootTemplate(mapTemplate, animated: true)
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.requestLocation()
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController,
    from window: CPWindow
  ) {
    navigationSession?.cancelTrip()
    navigationSession = nil
    self.interfaceController = nil
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    currentLocation = location
    if activeRoute == nil {
      mapView.setRegion(MKCoordinateRegion(
        center: location.coordinate,
        latitudinalMeters: 9000,
        longitudinalMeters: 9000
      ), animated: false)
      loadStations(near: location)
    } else {
      advanceGuidance(from: location)
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    presentMessage("Open Fuel Finder on your iPhone and allow location access, then reconnect CarPlay.")
  }

  private func loadStations(near location: CLLocation) {
    guard let base = Bundle.main.object(forInfoDictionaryKey: "FUEL_FINDER_API_BASE_URL") as? String,
          var components = URLComponents(string: base + "/api/stations/search") else {
      presentMessage("Fuel Finder API URL is not configured.")
      return
    }
    components.queryItems = [
      URLQueryItem(name: "latitude", value: String(location.coordinate.latitude)),
      URLQueryItem(name: "longitude", value: String(location.coordinate.longitude)),
      URLQueryItem(name: "miles", value: "5"),
      URLQueryItem(name: "sort", value: "closest"),
      URLQueryItem(name: "limit", value: "20"),
    ]
    guard let url = components.url else { return }
    URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
      guard let self else { return }
      guard let data, error == nil,
            let response = try? JSONDecoder().decode(StationSearchResponse.self, from: data) else {
        DispatchQueue.main.async { self.presentMessage("Could not load nearby stations. Check the API connection.") }
        return
      }
      DispatchQueue.main.async {
        self.stations = response.stations
        self.addStationAnnotations()
        if self.stations.isEmpty { self.presentMessage("No stations found within 5 miles.") }
        else { self.showStations() }
      }
    }.resume()
  }

  private func addStationAnnotations() {
    mapView.removeAnnotations(mapView.annotations.filter { !($0 is MKUserLocation) })
    let annotations = stations.map { station -> MKPointAnnotation in
      let annotation = MKPointAnnotation()
      annotation.coordinate = CLLocationCoordinate2D(latitude: station.latitude, longitude: station.longitude)
      annotation.title = station.name
      annotation.subtitle = [station.bestPrice, station.address].filter { !$0.isEmpty }.joined(separator: " · ")
      return annotation
    }
    mapView.addAnnotations(annotations)
  }

  private func showStations() {
    let rows = stations.map { station in
      let details = [String(format: "%.1f mi", station.distanceMiles), station.bestPrice, station.address]
        .filter { !$0.isEmpty }
        .joined(separator: " · ")
      return CPListItem(text: station.name, detailText: details)
    }
    for (index, row) in rows.enumerated() {
      row.handler = { [weak self] _, completion in
        self?.previewRoute(to: self?.stations[index])
        completion()
      }
    }
    let section = CPListSection(items: rows, header: "Nearby fuel stations", sectionIndexTitle: nil)
    interfaceController?.pushTemplate(CPListTemplate(title: "Nearby fuel", sections: [section]), animated: true)
  }

  private func previewRoute(to station: FuelStation?) {
    guard let station, let origin = currentLocation else { return }
    let destination = CLLocationCoordinate2D(latitude: station.latitude, longitude: station.longitude)
    let request = MKDirections.Request()
    request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin.coordinate))
    request.destination = MKMapItem(placemark: MKPlacemark(coordinate: destination))
    request.transportType = .automobile
    MKDirections(request: request).calculate { [weak self] response, error in
      guard let self, let route = response?.routes.first, error == nil else {
        DispatchQueue.main.async { self?.presentMessage("Could not calculate a driving route.") }
        return
      }
      DispatchQueue.main.async {
        self.activeRoute = route
        self.mapView.removeOverlays(self.mapView.overlays)
        self.mapView.addOverlay(route.polyline)
        self.mapView.setVisibleMapRect(route.polyline.boundingMapRect, edgePadding: UIEdgeInsets(top: 90, left: 60, bottom: 90, right: 60), animated: true)
        let destinationItem = MKMapItem(placemark: MKPlacemark(coordinate: destination))
        destinationItem.name = station.name
        let originItem = MKMapItem(placemark: MKPlacemark(coordinate: origin.coordinate))
        originItem.name = "Current Location"
        let choice = CPRouteChoice(
          summaryVariants: [route.name.isEmpty ? "Fastest route" : route.name],
          additionalInformationVariants: [],
          selectionSummaryVariants: [String(format: "%.0f min · %.1f mi", route.expectedTravelTime / 60, route.distance / 1609.34)]
        )
        let trip = CPTrip(origin: originItem, destination: destinationItem, routeChoices: [choice])
        self.activeTrip = trip
        let estimates = CPTravelEstimates(
          distanceRemaining: Measurement(value: route.distance, unit: UnitLength.meters),
          timeRemaining: route.expectedTravelTime
        )
        self.mapTemplate.update(estimates, for: trip)
        self.mapTemplate.showTripPreviews([trip], textConfiguration: nil)
      }
    }
  }

  func mapTemplate(_ mapTemplate: CPMapTemplate, selectedPreviewFor trip: CPTrip, using routeChoice: CPRouteChoice) {
    guard let route = activeRoute else { return }
    mapTemplate.update(
      CPTravelEstimates(
        distanceRemaining: Measurement(value: route.distance, unit: UnitLength.meters),
        timeRemaining: route.expectedTravelTime
      ),
      for: trip
    )
  }

  func mapTemplate(_ mapTemplate: CPMapTemplate, startedTrip trip: CPTrip, using routeChoice: CPRouteChoice) {
    guard let route = activeRoute else { return }
    let session = mapTemplate.startNavigationSession(for: trip)
    navigationSession = session
    maneuverLocations = route.steps.map { CLLocation(latitude: $0.polyline.coordinate.latitude, longitude: $0.polyline.coordinate.longitude) }
    activeManeuverIndex = 0
    session.upcomingManeuvers = route.steps.filter { !$0.instructions.isEmpty }.map { step in
      let maneuver = CPManeuver()
      maneuver.instructionVariants = [step.instructions]
      maneuver.initialTravelEstimates = CPTravelEstimates(
        distanceRemaining: Measurement(value: step.distance, unit: UnitLength.meters),
        timeRemaining: step.expectedTravelTime
      )
      return maneuver
    }
    locationManager.startUpdatingLocation()
  }

  private func advanceGuidance(from location: CLLocation) {
    guard let route = activeRoute, let session = navigationSession else { return }
    while activeManeuverIndex < maneuverLocations.count - 1,
          location.distance(from: maneuverLocations[activeManeuverIndex]) < 45 {
      activeManeuverIndex += 1
    }
    let remaining = route.steps.dropFirst(activeManeuverIndex)
    let maneuvers = remaining.filter { !$0.instructions.isEmpty }.map { step in
      let maneuver = CPManeuver()
      maneuver.instructionVariants = [step.instructions]
      maneuver.initialTravelEstimates = CPTravelEstimates(
        distanceRemaining: Measurement(value: step.distance, unit: UnitLength.meters),
        timeRemaining: step.expectedTravelTime
      )
      return maneuver
    }
    if !maneuvers.isEmpty { session.upcomingManeuvers = maneuvers }
  }

  private func presentMessage(_ message: String) {
    let item = CPListItem(text: message, detailText: nil)
    interfaceController?.pushTemplate(
      CPListTemplate(title: "Fuel Finder", sections: [CPListSection(items: [item])]),
      animated: true
    )
  }
}

extension CarPlaySceneDelegate: MKMapViewDelegate {
  func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
    let renderer = MKPolylineRenderer(overlay: overlay)
    renderer.strokeColor = UIColor.systemGreen
    renderer.lineWidth = 7
    return renderer
  }
}