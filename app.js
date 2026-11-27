
// ==========================================
// AUVASA GPS 3.0 - MOTOR PRINCIPAL
// CONDUCTOR + PASAJERO
// ==========================================

// ==========================================
// MAPA DEL CONDUCTOR
// ==========================================

const map = L.map('map').setView([41.6523, -4.7245], 13);
window.map = map;

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

// ==========================================
// DATOS GTFS
// ==========================================

let tables = {};
let routes = [];
let trips = [];
let stops = [];
let shapes = [];
let stopTimesByTrip = new Map();
let stopTimesByStop = new Map();
let gps = null;
let watch = null;
let routeLayer = null;
let stopLayer = null;
let busMarker = null;
let activeStops = [];
let stopIndex = 0;
let activeTrip = null;
let announcedStops = new Set();

const $ = id => document.getElementById(id);

// MAPA PASAJERO

let passengerMap = null;
let passengerRouteLayer = null;
let passengerStopLayer = null;

window.passengerMap = null;

let selectedOrigin = null;
let selectedDestination = null;

// ==========================================
// LECTOR CSV
// ==========================================

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

// ==========================================
// CARGAR GTFS
// ==========================================

async function loadGTFS(zip) {
  tables = {};

  const required = [
    'routes.txt',
    'trips.txt',
    'stops.txt',
    'stop_times.txt'
  ];

  const getFile = name => {
    const files = zip.file(new RegExp('(^|/)' + name + '$', 'i'));
    return files.length ? files[0] : null;
  };

  for (const name of [
  ...required,
  'shapes.txt',
  'calendar.txt',
  'calendar_dates.txt'
]) {
    const file = getFile(name);

    if (file) {
      tables[name] = csv(await file.async('text'));
    }
  }

  for (const name of required) {
    if (!tables[name]) {
      throw new Error('Falta el archivo ' + name);
    }
  }

  routes = tables['routes.txt'];
trips = tables['trips.txt'];
stops = tables['stops.txt'];
shapes = tables['shapes.txt'] || [];
// Crear índices rápidos de horarios
stopTimesByTrip = new Map();
stopTimesByStop = new Map();

tables['stop_times.txt'].forEach(item => {
  if (!stopTimesByTrip.has(item.trip_id)) {
    stopTimesByTrip.set(item.trip_id, []);
  }

  if (!stopTimesByStop.has(item.stop_id)) {
    stopTimesByStop.set(item.stop_id, []);
  }

  stopTimesByTrip.get(item.trip_id).push(item);
  stopTimesByStop.get(item.stop_id).push(item);
});

stopTimesByTrip.forEach(items => {
  items.sort((a, b) =>
    Number(a.stop_sequence) - Number(b.stop_sequence)
  );
});
const calendars = tables['calendar.txt'] || [];
const calendarDates = tables['calendar_dates.txt'] || [];

window.gtfsCalendars = {
  calendars,
  calendarDates
};

  // Cargar líneas del conductor

  const driverLine = $('line');

  driverLine.innerHTML = '<option value="">Selecciona línea</option>';

  routes.forEach(route => {
    const option = document.createElement('option');
    option.value = route.route_id;
    option.textContent =
      (route.route_short_name || route.route_id) +
      ' — ' + (route.route_long_name || '');

    driverLine.append(option);
  });

  driverLine.disabled = false;

  $('direction').disabled = true;
  $('start').disabled = true;

  // Cargar selectores del pasajero

  populatePassengerSelects();

  $('status').textContent =
    `Datos GTFS cargados: ${routes.length} líneas y ${stops.length} paradas.`;

  $('passengerStatus').textContent =
    `Datos disponibles: ${routes.length} líneas y ${stops.length} paradas.`;
}

// ==========================================
// DESCARGA AUTOMÁTICA
// ==========================================

async function automaticGTFS() {
  $('status').textContent = 'Descargando datos oficiales de AUVASA...';

  try {
    const response = await fetch('data/gtfs.zip', {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('No se encuentra el archivo GTFS.');
    }

    const blob = await response.blob();

    if (!blob.size) {
      throw new Error('El archivo GTFS está vacío.');
    }

    const zip = await JSZip.loadAsync(blob);
    await loadGTFS(zip);

    console.log('GTFS cargado correctamente.');

  } catch (error) {
    console.error('Error GTFS:', error);

    $('status').textContent =
      'No se pudieron descargar los datos automáticamente. Puedes cargar el ZIP manualmente.';

    $('passengerStatus').textContent =
      'No se han podido cargar los datos. Comprueba la conexión o carga el ZIP desde el modo conductor.';
  }
}

// ==========================================
// CARGA MANUAL
// ==========================================

$('gtfs').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  $('status').textContent = 'Leyendo archivo GTFS...';

  try {
    const zip = await JSZip.loadAsync(file);
    await loadGTFS(zip);
  } catch (error) {
    console.error(error);
    $('status').textContent = 'Error al cargar GTFS: ' + error.message;
  }
});

// ==========================================
// UTILIDADES GTFS
// ==========================================

function stopObj(id) {
  return stops.find(stop => stop.stop_id === id);
}

function routeObj(id) {
  return routes.find(route => route.route_id === id);
}

function routeName(id) {
  const route = routeObj(id);
  return route
    ? (route.route_short_name || route.route_id)
    : id;
}

function tripStops(tripId) {
  return stopTimesByTrip.get(tripId) || [];
}

function getDirections(lineId) {
  return [...new Set(
    trips
      .filter(t => t.route_id === lineId)
      .map(t => t.direction_id || '0')
  )].sort();
}

function directionName(value) {
  return value === '0' ? 'Sentido 1' :
         value === '1' ? 'Sentido 2' :
         'Sentido ' + value;
}

function representativeTrip(lineId, directionId) {
  return trips.find(t =>
    t.route_id === lineId &&
    (t.direction_id || '0') === directionId
  );
}

function fillDirections(select, lineId) {
  select.innerHTML = '<option value="">Selecciona un sentido</option>';

  if (!lineId) {
    select.disabled = true;
    return;
  }

  getDirections(lineId).forEach(direction => {
    const option = document.createElement('option');
    option.value = direction;
    option.textContent = directionName(direction);
    select.append(option);
  });

  select.disabled = false;
}

function fillLineSelect(select) {
  select.innerHTML = '<option value="">Selecciona una línea</option>';

  routes.forEach(route => {
    const option = document.createElement('option');
    option.value = route.route_id;
    option.textContent =
      (route.route_short_name || route.route_id) +
      ' — ' + (route.route_long_name || '');

    select.append(option);
  });
}

// ==========================================
// CONDUCTOR: SELECCIÓN DE LÍNEA
// ==========================================

$('line').addEventListener('change', () => {
  const id = $('line').value;
  fillDirections($('direction'), id);

  $('start').disabled = !id || !getDirections(id).length;
});

// ==========================================
// CONDUCTOR: AVISOS POR VOZ
// ==========================================

function announce(message) {
  if (!('speechSynthesis' in window)) return;

  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'es-ES';

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

// ==========================================
// CONDUCTOR: INICIAR GPS
// ==========================================

$('start').onclick = () => {
  const lineId = $('line').value;
  const directionId = $('direction').value;

  const trip = representativeTrip(lineId, directionId);

  if (!trip) {
    $('status').textContent = 'No hay viajes disponibles para este sentido.';
    return;
  }

  if (!navigator.geolocation) {
    $('status').textContent = 'GPS no disponible.';
    return;
  }

  if (watch !== null) {
    navigator.geolocation.clearWatch(watch);
  }

  activeTrip = trip;

  const stopTimes = tripStops(trip.trip_id);

  activeStops = stopTimes
    .map(s => stopObj(s.stop_id))
    .filter(Boolean);

  if (!activeStops.length) {
    $('status').textContent = 'Este viaje no tiene paradas disponibles.';
    return;
  }

  stopIndex = 0;
  announcedStops.clear();
  gps = null;

  draw(trip);

  $('stop').disabled = false;
  $('start').disabled = true;

  $('status').textContent = 'Iniciando navegación GPS...';

  announce('Navegación iniciada. Primera parada: ' + activeStops[0].stop_name);

  watch = navigator.geolocation.watchPosition(
    position => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const speed = position.coords.speed;

      $('speed').textContent = speed === null
        ? '--'
        : Math.round(speed * 3.6);

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
      $('status').textContent = 'Error GPS: ' + error.message;
    },

    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000
    }
  );

  $('status').textContent = 'Navegación GPS activa. Sigue el recorrido resaltado.';
};

// ==========================================
// CONDUCTOR: DIBUJAR RECORRIDO
// ==========================================

function draw(trip) {
  if (routeLayer) map.removeLayer(routeLayer);
  if (stopLayer) map.removeLayer(stopLayer);

  const points = shapes
    .filter(s => s.shape_id === trip.shape_id)
    .sort((a, b) =>
      Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
    )
    .map(s => [
      Number(s.shape_pt_lat),
      Number(s.shape_pt_lon)
    ])
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));

  if (points.length) {
    routeLayer = L.polyline(points, {
      color: '#087fc1',
      weight: 6,
      opacity: 0.85
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), { padding: [25, 25] });
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
    .bindTooltip((index + 1) + '. ' + stop.stop_name);
  });

  if (!points.length && activeStops.length) {
    map.fitBounds(activeStops.map(s => [
      Number(s.stop_lat),
      Number(s.stop_lon)
    ]), { padding: [25, 25] });
  }
}

// ==========================================
// CONDUCTOR: PRÓXIMA PARADA
// ==========================================

function updateNext() {
  if (!gps || !activeStops.length) return;

  const stop = activeStops[stopIndex];
  if (!stop) return;

  const distance = map.distance(gps, [
    Number(stop.stop_lat),
    Number(stop.stop_lon)
  ]);

  if (distance < 35 && !announcedStops.has(stopIndex)) {
    announcedStops.add(stopIndex);
    announce('Parada: ' + stop.stop_name);

    if (stopIndex < activeStops.length - 1) {
      stopIndex++;
      announce('Próxima parada: ' + activeStops[stopIndex].stop_name);
    } else {
      $('nextstop').textContent = 'Final de recorrido';
      $('distance').textContent = 'Última parada alcanzada';
      announce('Fin del recorrido');
      return;
    }
  }

  const nextStop = activeStops[stopIndex];

  const nextDistance = map.distance(gps, [
    Number(nextStop.stop_lat),
    Number(nextStop.stop_lon)
  ]);

  $('nextstop').textContent = nextStop.stop_name;

  $('distance').textContent = nextDistance < 100
    ? 'Parada próxima'
    : `Aproximadamente ${Math.round(nextDistance)} metros`;
}

// ==========================================
// CONDUCTOR: FINALIZAR
// ==========================================

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

// ==========================================
// PASAJERO: SELECTORES
// ==========================================

function populatePassengerSelects() {
  fillLineSelect($('passengerMapLine'));
  fillLineSelect($('passengerLine'));
  fillLineSelect($('timetableLine'));
}

// ==========================================
// PASAJERO: CAMBIO DE PANTALLA
// ==========================================

function passengerView(view) {
  document.querySelectorAll('.passenger-view').forEach(section => {
    section.hidden = true;
  });

  if (view === 'menu') {
    document.querySelector('.passenger-options').hidden = false;
    document.querySelector('.passenger-heading').hidden = false;
    $('passengerStatus').hidden = false;
    return;
  }

  document.querySelector('.passenger-options').hidden = true;
  document.querySelector('.passenger-heading').hidden = true;
  $('passengerStatus').hidden = true;

  const section = $('view-' + view);
  if (section) section.hidden = false;

  if (view === 'map') {
    setTimeout(() => {
      initPassengerMap();
      if (passengerMap) passengerMap.invalidateSize();
      drawPassengerMap($('passengerMapLine').value);
    }, 200);
  }
}

window.passengerView = passengerView;

// ==========================================
// PASAJERO: MAPA GENERAL
// ==========================================

function initPassengerMap() {
  if (passengerMap) return;

  passengerMap = L.map('passengerMap').setView([41.6523, -4.7245], 13);
  window.passengerMap = passengerMap;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(passengerMap);

  passengerRouteLayer = L.layerGroup().addTo(passengerMap);
  passengerStopLayer = L.layerGroup().addTo(passengerMap);
}

function drawPassengerMap(selectedLine) {
  if (!passengerMap || !routes.length) return;

  passengerRouteLayer.clearLayers();
  passengerStopLayer.clearLayers();

  const usedShapes = new Set();
  const bounds = [];

  trips.forEach(trip => {
    if (selectedLine && trip.route_id !== selectedLine) return;
    if (!trip.shape_id || usedShapes.has(trip.shape_id)) return;

    usedShapes.add(trip.shape_id);

    const points = shapes
      .filter(s => s.shape_id === trip.shape_id)
      .sort((a, b) =>
        Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence)
      )
      .map(s => [
        Number(s.shape_pt_lat),
        Number(s.shape_pt_lon)
      ])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));

    if (points.length) {
      const route = routeObj(trip.route_id);
      const color = route && route.route_color
        ? '#' + route.route_color
        : '#087fc1';

      L.polyline(points, {
        color,
        weight: selectedLine ? 6 : 3,
        opacity: selectedLine ? 0.9 : 0.55
      })
      .bindPopup('Línea ' + routeName(trip.route_id))
      .addTo(passengerRouteLayer);

      bounds.push(...points);
    }
  });

  // Si no existen shapes, se dibujan recorridos con paradas

  if (!bounds.length) {
    const seen = new Set();

    trips.forEach(trip => {
      if (selectedLine && trip.route_id !== selectedLine) return;

      const points = tripStops(trip.trip_id)
        .map(item => stopObj(item.stop_id))
        .filter(stop => stop && stop.stop_lat && stop.stop_lon)
        .map(stop => [
          Number(stop.stop_lat),
          Number(stop.stop_lon)
        ]);

      const key = trip.route_id + '-' + (trip.direction_id || '0');

      if (seen.has(key) || points.length < 2) return;
      seen.add(key);

      L.polyline(points, {
        color: '#087fc1',
        weight: 4,
        opacity: 0.7
      }).addTo(passengerRouteLayer);

      bounds.push(...points);
    });
  }

  stops.forEach(stop => {
    if (!stop.stop_lat || !stop.stop_lon) return;

    L.circleMarker([
      Number(stop.stop_lat),
      Number(stop.stop_lon)
    ], {
      radius: 3,
      color: '#087fc1',
      fillColor: '#ffffff',
      fillOpacity: 0.9,
      weight: 1
    })
    .bindPopup(stop.stop_name)
    .addTo(passengerStopLayer);
  });

  if (bounds.length) {
    passengerMap.fitBounds(bounds, { padding: [25, 25] });
  }
}

$('passengerMapLine').addEventListener('change', e => {
  drawPassengerMap(e.target.value);
});

// ==========================================
// PASAJERO: BUSCADOR DE LÍNEAS
// ==========================================

$('passengerLine').addEventListener('change', () => {
  const lineId = $('passengerLine').value;

  fillDirections($('passengerDirection'), lineId);

  $('lineDetails').textContent =
    lineId ? 'Selecciona un sentido para consultar el recorrido.' :
    'Selecciona una línea para ver sus detalles.';
});

$('passengerDirection').addEventListener('change', () => {
  const lineId = $('passengerLine').value;
  const directionId = $('passengerDirection').value;

  const trip = representativeTrip(lineId, directionId);

  if (!trip) return;

  const route = routeObj(lineId);
  const items = tripStops(trip.trip_id);

  $('lineDetails').replaceChildren();

  const heading = document.createElement('strong');
  heading.textContent = 'Línea ' + routeName(lineId);

  const description = document.createElement('p');
  description.textContent =
    (route?.route_long_name || '') + ' · ' + directionName(directionId);

  $('lineDetails').append(heading, description);

  const list = document.createElement('ol');

  items.forEach(item => {
    const stop = stopObj(item.stop_id);
    if (!stop) return;

    const li = document.createElement('li');
    li.textContent = stop.stop_name;
    list.append(li);
  });

  $('lineDetails').append(list);
});

// ==========================================
// PASAJERO: BUSCADOR DE PARADAS
// ==========================================

function searchStops(query) {
  const text = query.trim().toLocaleLowerCase('es');

  if (text.length < 2) return [];

  return stops
    .filter(stop =>
      (stop.stop_name || '').toLocaleLowerCase('es').includes(text)
    )
    .slice(0, 15);
}

function routesAtStop(stopId) {
  const routeIds = new Set();

  tables['stop_times.txt']
    .filter(item => item.stop_id === stopId)
    .forEach(item => {
      const trip = trips.find(t => t.trip_id === item.trip_id);
      if (trip) routeIds.add(trip.route_id);
    });

  return [...routeIds];
}

function showStopResults(container, query, onSelect) {
  container.replaceChildren();

  const matches = searchStops(query);

  if (!query.trim()) {
    container.textContent = 'Escribe el nombre de una parada.';
    return;
  }

  if (!matches.length) {
    container.textContent = 'No se han encontrado paradas.';
    return;
  }

  matches.forEach(stop => {
    const item = document.createElement('div');
    item.className = 'result-item';

    const title = document.createElement('strong');
    title.textContent = stop.stop_name;

    const detail = document.createElement('small');
    detail.textContent = 'Consulta las líneas disponibles';

    const button = document.createElement('button');
    button.textContent = 'Ver parada';
    button.onclick = () => onSelect(stop);

    item.append(title, detail, button);
    container.append(item);
  });
}

$('stopSearch').addEventListener('input', () => {
  showStopResults($('stopResults'), $('stopSearch').value, stop => {
    const lines = routesAtStop(stop.stop_id);

    $('stopResults').replaceChildren();

    const title = document.createElement('h3');
    title.textContent = stop.stop_name;

    const description = document.createElement('p');
    description.textContent = lines.length
      ? 'Líneas que pasan por esta parada:'
      : 'No se han encontrado líneas asociadas.';

    const list = document.createElement('p');
    list.textContent = lines.map(routeName).join(', ');

    $('stopResults').append(title, description, list);

    if (passengerMap && stop.stop_lat && stop.stop_lon) {
      passengerMap.setView([
        Number(stop.stop_lat),
        Number(stop.stop_lon)
      ], 17);
    }
  });
});

// ==========================================
// PASAJERO: HORARIOS
// ==========================================

$('timetableLine').addEventListener('change', () => {
  fillDirections($('timetableDirection'), $('timetableLine').value);

  $('timetableStop').innerHTML =
    '<option value="">Selecciona una parada</option>';

  $('timetableStop').disabled = true;
  $('timetableResults').textContent = 'Selecciona un sentido.';
});

$('timetableDirection').addEventListener('change', () => {
  const lineId = $('timetableLine').value;
  const directionId = $('timetableDirection').value;

  const trip = representativeTrip(lineId, directionId);

  $('timetableStop').innerHTML =
    '<option value="">Selecciona una parada</option>';

  if (!trip) return;

  tripStops(trip.trip_id).forEach(item => {
    const stop = stopObj(item.stop_id);
    if (!stop) return;

    const option = document.createElement('option');
    option.value = stop.stop_id;
    option.textContent = stop.stop_name;
    $('timetableStop').append(option);
  });

  $('timetableStop').disabled = false;
  $('timetableResults').textContent = 'Selecciona una parada.';
});

function formatTime(time) {
  if (!time) return '--:--';

  const parts = time.split(':');
  if (parts.length < 2) return time;

  return parts[0].padStart(2, '0') + ':' +
    parts[1].padStart(2, '0');
}

$('timetableStop').addEventListener('change', () => {
  const lineId = $('timetableLine').value;
  const directionId = $('timetableDirection').value;
  const stopId = $('timetableStop').value;

  if (!stopId) return;

  const departures = [];

  trips
    .filter(t =>
      t.route_id === lineId &&
      (t.direction_id || '0') === directionId
    )
    .forEach(trip => {
      const item = tables['stop_times.txt'].find(s =>
        s.trip_id === trip.trip_id &&
        s.stop_id === stopId
      );

      if (item && item.departure_time) {
        departures.push({
          time: item.departure_time,
          tripId: trip.trip_id
        });
      }
    });

  departures.sort((a, b) =>
    a.time.localeCompare(b.time)
  );

  $('timetableResults').replaceChildren();

  const heading = document.createElement('strong');
  heading.textContent = 'Salidas programadas';

  const note = document.createElement('p');
  note.textContent =
    'Horarios publicados en GTFS. Pueden variar según el día de servicio.';

  $('timetableResults').append(heading, note);

  if (!departures.length) {
    $('timetableResults').append('No hay salidas disponibles para esta selección.');
    return;
  }

  const list = document.createElement('div');

  departures.forEach(departure => {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.textContent = formatTime(departure.time);
    list.append(item);
  });

  $('timetableResults').append(list);
});
// ==========================================
// PLANIFICADOR: CALENDARIO DE SERVICIO
// ==========================================

function getActiveServiceIds(date = new Date()) {
  const calendars = window.gtfsCalendars?.calendars || [];
  const exceptions = window.gtfsCalendars?.calendarDates || [];

  // Si no hay calendarios, no podemos verificar el servicio
  if (!calendars.length && !exceptions.length) {
    return null;
  }

  const dateKey =
    date.getFullYear() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0');

  const weekdays = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday'
  ];

  const weekday = weekdays[date.getDay()];
  const active = new Set();

  calendars.forEach(calendar => {
    if (
      dateKey >= calendar.start_date &&
      dateKey <= calendar.end_date &&
      calendar[weekday] === '1'
    ) {
      active.add(calendar.service_id);
    }
  });

  // Aplicar excepciones oficiales
  exceptions
    .filter(item => item.date === dateKey)
    .forEach(item => {
      if (item.exception_type === '1') {
        active.add(item.service_id);
      } else if (item.exception_type === '2') {
        active.delete(item.service_id);
      }
    });

  return active;
}

function isTripServiceActive(trip, activeServices) {
  if (activeServices === null) return true;

  return activeServices.has(trip.service_id);
}

// Convertir horas GTFS a segundos
function timeToSeconds(time) {
  if (!time) return null;

  const parts = time.split(':').map(Number);

  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
    return null;
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
// ==========================================
// PASAJERO: PLANIFICADOR
// ==========================================

function setupPlannerSearch(inputId, resultsId, type) {
  $(inputId).addEventListener('input', () => {
    showStopResults($(resultsId), $(inputId).value, stop => {
      if (type === 'origin') {
        selectedOrigin = stop;
        $(inputId).value = stop.stop_name;
      } else {
        selectedDestination = stop;
        $(inputId).value = stop.stop_name;
      }

      $(resultsId).replaceChildren();

      const selected = document.createElement('div');
      selected.className = 'result-item';
      selected.textContent = 'Seleccionado: ' + stop.stop_name;
      $(resultsId).append(selected);
    });
  });
}

setupPlannerSearch('originSearch', 'originResults', 'origin');
setupPlannerSearch('destinationSearch', 'destinationResults', 'destination');

$('planJourney').addEventListener('click', () => {
  const output = $('journeyResults');
  output.replaceChildren();

  if (!selectedOrigin || !selectedDestination) {
    output.textContent = 'Selecciona un origen y un destino de las sugerencias.';
    return;
  }

  if (selectedOrigin.stop_id === selectedDestination.stop_id) {
    output.textContent = 'El origen y el destino son la misma parada.';
    return;
  }

  const journeys = [];

  trips.forEach(trip => {
    const items = tripStops(trip.trip_id);

    const originIndex = items.findIndex(
      item => item.stop_id === selectedOrigin.stop_id
    );

    const destinationIndex = items.findIndex(
      item => item.stop_id === selectedDestination.stop_id
    );

    if (
      originIndex !== -1 &&
      destinationIndex !== -1 &&
      destinationIndex > originIndex
    ) {
      journeys.push({
        trip,
        origin: items[originIndex],
        destination: items[destinationIndex]
      });
    }
  });

  const heading = document.createElement('strong');
  heading.textContent = 'Resultados de tu búsqueda';
  output.append(heading);

  if (!journeys.length) {
    const message = document.createElement('p');
    message.textContent =
      'No se ha encontrado un trayecto directo. La búsqueda de transbordos estará disponible en una próxima actualización.';
    output.append(message);
    return;
  }

  const unique = new Map();

  journeys.forEach(journey => {
    const key = journey.trip.route_id + '-' +
      (journey.trip.direction_id || '0');

    if (!unique.has(key)) unique.set(key, journey);
  });

  [...unique.values()].forEach(journey => {
    const item = document.createElement('div');
    item.className = 'result-item';

    const title = document.createElement('strong');
    title.textContent = 'Línea ' + routeName(journey.trip.route_id);

    const detail = document.createElement('small');
    detail.textContent =
      directionName(journey.trip.direction_id || '0') +
      ' · Salida: ' + formatTime(journey.origin.departure_time) +
      ' · Llegada: ' + formatTime(journey.destination.arrival_time);

    item.append(title, detail);
    output.append(item);
  });
});

// ==========================================
// INCIDENCIAS
// ==========================================

$('alertsResults').textContent =
  'El apartado está preparado para mostrar avisos oficiales. Todavía no hay una fuente de incidencias conectada.';

// ==========================================
// SERVICE WORKER
// ==========================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(error => console.error(
        'Error registrando Service Worker:', error
      ));
  });
}

// ==========================================
// INICIO
// ==========================================

automaticGTFS();
