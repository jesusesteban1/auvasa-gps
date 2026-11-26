# AUVASA GPS — prototipo multiplataforma

PWA básica para Android e iOS. Permite importar un ZIP GTFS estándar de AUVASA, seleccionar línea y dirección, visualizar la geometría de la ruta y paradas, activar GPS y anunciar la próxima parada por voz.

## Ejecutar
La geolocalización necesita HTTPS o localhost. Servir esta carpeta con un servidor web HTTPS; abrir `index.html` directamente no permite GPS en la mayoría de móviles.

## Limitaciones de esta primera versión
- No incluye el feed GTFS oficial; hay que importar el ZIP en el selector.
- Requiere `routes.txt`, `trips.txt`, `stops.txt`, `stop_times.txt`; `shapes.txt` es opcional.
- Usa Leaflet/OpenStreetMap y JSZip desde CDN; requiere conexión para cargar librerías y mapa.
- Es un prototipo, no una herramienta certificada para operación en servicio.
- No incluye todavía radares, límites de velocidad fiables, alertas de seguridad ni navegación giro a giro. Esos módulos requieren fuentes oficiales/validadas y pruebas de campo.
- El seguimiento de paradas es aproximado por GPS; debe validarse antes de uso real.
