
// ==========================================
// AUVASA GPS - MOTOR PRINCIPAL
// ==========================================

// MAPA
const map = L.map('map').setView([41.6523, -4.7245], 13);
window.map = map;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

// DATOS GTFS
let tables = {};
let routes = [];
let trips = [];
let stops = [];
let shapes = [];

let gps = null;
let watch = null;
let routeLayer = null;
let stopLayer = null;
let busMarker = null;
let activeStops = [];
let stopIndex = 0;
let activeTrip = null;

// ELEMENTOS HTML
const $ = id => document.getElementById(id);

// LECTOR CSV GTFS
function csv(content) {
  const lines = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const parseLine = line => {
    const result = [];
    let value = '';
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];

      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (c === ',' && !quoted) {
        result.push(value);
        value = '';
      } else {
        value += c;
      }
    }

    result.push(value);
    return result;
  };

  const headers = parseLine(lines.shift());

  return lines.filter(line => line.trim()).map(line => {
    const values = parseLine(line);
    return Object.fromEntries(
      headers.map((header, i) => [header.trim(), values[i] || ''])
    );
  });
}

// CARGAR GTFS
$('gtfs').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  $('status').textContent = 'Leyendo datos oficiales GTFS...';

  try {
    const zip = await JSZip.loadAsync(file);
    tables = {};

    for (const name of [
      'routes.txt',
      'trips.txt',
      'stops.txt',
      'stop_times.txt',
      'shapes.txt'
    ]) {
      if (zip.file(name)) {
        tables[name] = csv(await zip.file(name).async('text'));
      }
    }

    if (!tables['routes.txt'] ||
        !tables['trips.txt'] ||
        !tables['stops.txt'] ||
        !tables['stop_times.txt']) {
      throw new Error('Faltan archivos GTFS obligatorios.');
    }

    routes = tables['routes.txt'];
    trips = tables['trips.txt'];
    stops = tables['stops.txt'];
    shapes = tables['shapes.txt'] || [];

    const select = $('line');
    select.innerHTML = '<option value="">Selecciona línea</option>';

    routes.forEach(route => {
      const option = document.createElement('option');
      option.value = route.route_id;
      option.textContent =
        (route.route_short_name || route.route_id) +
        ' — ' + (route.route_long_name || '');

      select.append(option);
    });

    select.disabled = false;
    $('status').textContent =
      `GTFS cargado correctamente: ${routes.length} líneas y ${stops.length} paradas.`;

  } catch (error) {
    console.error(error);
    $('status').textContent =
      'Error al cargar GTFS: ' + error.message;
  }
});

// SELECCIÓN DE LÍNEA
$('line').addEventListener('change', () => {
  const id = $('line').value;
  const direction = $('direction');

  direction.innerHTML = '';

  const availableTrips = trips.filter(t => t.route_id === id);
  const directions = [...new Set(
    availableTrips.map(t => t.direction_id || '0')
  )];

  directions.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent =
      value === '0' ? 'Sentido 1' :
      value === '1' ? 'Sentido 2' :
      'Sentido ' + value;

    direction.append(option);
  });

  direction.disabled = !id || directions.length === 0;
  $('start').disabled = !id || directions.length === 0;
});

function stopObj(id) {
  return stops.find(stop => stop.stop_id === id);
}

// AVISOS POR VOZ
function announce(message) {
  if (!('speechSynthesis' in window)) return;

  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'es-ES';

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

// INICIAR NAVEGACIÓN
$('start').onclick = () => {
  const lineId = $('line').value;
  const directionId = $('direction').value;

  const trip = trips.find(t =>
    t.route_id === lineId &&
    (t.direction_id || '0') === directionId
  );

  if (!trip) {
    $('status').textContent =
      'No hay viajes disponibles para este sentido.';
    return;
  }

  if (!navigator.geolocation) {
    $('status').textContent = 'GPS no disponible en este navegador.';
    return;
  }

  if (watch !== null) {
    navigator.geolocation.clearWatch(watch);
  }

  activeTrip = trip;

  const stopTimes = tables['stop_times.txt']
    .filter(s => s.trip_id === trip.trip_id)
    .sort((a, b) =>
      Number(a.stop_sequence) - Number(b.stop_sequence)
    );

  activeStops = stopTimes
    .map(s => stopObj(s.stop_id))
    .filter(Boolean);

  if (!activeStops.length) {
    $('status').textContent =
      'Este viaje no tiene paradas disponibles.';
    return;
  }

  stopIndex = 0;
  gps = null;

  draw(trip);

  $('stop').disabled = false;
  $('start').disabled = true;

  $('status').textContent = 'Iniciando navegación GPS...';

  announce('Navegación iniciada. ' +
    'Primera parada: ' + activeStops[0].stop_name);

  watch = navigator.geolocation.watchPosition(
    position => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      const speed = position.coords.speed;
      const velocity = speed === null
        ? '--'
        : Math.round(speed * 3.6);

      $('speed').textContent = velocity;

      gps = [latitude, longitude];

      if (!busMarker) {
        busMarker = L.circleMarker(gps, {
          radius: 9,
          color: '#087fc1',
          fillColor: '#ffffff',
          fillOpacity: 1,
          weight: 4
        }).addTo(map);
      } else {
        busMarker.setLatLng(gps);
      }

      map.panTo(gps);

      updateNext();
    },

    error => {
      $('status').textContent =
        'Error GPS: ' + error.message;
    },

    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000
    }
  );

  $('status').textContent =
    'Navegación GPS activa. Sigue el recorrido resaltado.';
};

// DIBUJAR RECORRIDO Y PARADAS
function draw(trip) {
  if (routeLayer) map.removeLayer(routeLayer);
  if (stopLayer) map.removeLayer(stopLayer);

  const points = shapes
    .filter(s => s.shape_id === trip.shape_id)
    .sort((a, b) =>
      Number(a.shape_pt_sequence) -
      Number(b.shape_pt_sequence)
    )
    .map(s => [
      Number(s.shape_pt_lat),
      Number(s.shape_pt_lon)
    ]);

  if (points.length) {
    routeLayer = L.polyline(points, {
      color: '#087fc1',
      weight: 6,
      opacity: 0.85
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), {
      padding: [25, 25]
    });
  }

  stopLayer = L.layerGroup().addTo(map);

  activeStops.forEach((stop, index) => {
    L.circleMarker([
      Number(stop.stop_lat),
      Number(stop.stop_lon)
    ], {
      radius: 6,
      color: '#10253f',
      fillColor: '#ffffff',
      fillOpacity: 1
    })
    .addTo(stopLayer)
    .bindTooltip(
      (index + 1) + '. ' + stop.stop_name
    );
  });

  if (!points.length) {
    const coordinates = activeStops.map(s => [
      Number(s.stop_lat),
      Number(s.stop_lon)
    ]);

    if (coordinates.length) {
      map.fitBounds(coordinates, { padding: [25, 25] });
    }
  }
}

// CONTROL DE PRÓXIMAS PARADAS
function updateNext() {
  if (!gps || !activeStops.length) return;

  const stop = activeStops[stopIndex];

  if (!stop) return;

  const distance = map.distance(gps, [
    Number(stop.stop_lat),
    Number(stop.stop_lon)
  ]);

  // Se considera alcanzada al estar a menos de 35 metros.
  if (distance < 35) {
    announce('Parada: ' + stop.stop_name);

    if (stopIndex < activeStops.length - 1) {
      stopIndex++;

      const next = activeStops[stopIndex];

      announce('Próxima parada: ' + next.stop_name);
    } else {
      $('nextstop').textContent = 'Final de recorrido';
      $('distance').textContent = 'Última parada alcanzada';
      announce('Fin del recorrido');

      return;
    }
  }

  const nextStop = activeStops[stopIndex];

  $('nextstop').textContent = nextStop.stop_name;

  $('distance').textContent =
    distance < 100
      ? 'Parada próxima'
      : `Aproximadamente ${Math.round(distance)} metros`;
}

// FINALIZAR NAVEGACIÓN
$('stop').onclick = () => {
  if (watch !== null) {
    navigator.geolocation.clearWatch(watch);
  }

  watch = null;
  gps = null;
  activeTrip = null;

  $('stop').disabled = true;
  $('start').disabled = !$('line').value;

  $('status').textContent = 'Navegación finalizada.';

  $('speed').textContent = '--';
  $('nextstop').textContent = 'Selecciona línea y sentido';
  $('distance').textContent = 'La navegación GPS aún no está activa';

  announce('Navegación finalizada');
};

// REGISTRO SERVICE WORKER
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(error => console.error(
        'Error registrando Service Worker:', error
      ));
  });
}
