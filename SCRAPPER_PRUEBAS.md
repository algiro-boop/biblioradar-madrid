# Scraper independiente de pruebas

Puedes copiar **solo `scrapper_gmaps_pruebas.py`** a cualquier carpeta de tu Mac y ejecutarlo allí. No importa módulos del proyecto, no lee `.env`, no conecta a Supabase ni modifica su base de datos. Necesitas Python 3.11+, Google Chrome y Selenium (ChromeDriver lo resuelve Selenium Manager).

Con `uv`, las dependencias están declaradas dentro del propio archivo y se instalan en un entorno aislado:

```sh
uv run scrapper_gmaps_pruebas.py --url "PEGA_AQUI_LA_URL_DE_LA_FICHA_EN_GOOGLE_MAPS"
```

Alternativa sin `uv`, dentro de una carpeta independiente:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install 'selenium>=4.30,<5'
python scrapper_gmaps_pruebas.py --url "PEGA_AQUI_LA_URL_DE_LA_FICHA_EN_GOOGLE_MAPS"
```

Pega la URL HTTPS de una ficha concreta (también admite enlaces `maps.app.goo.gl`). Chrome se abre visible. Si aparece consentimiento o CAPTCHA, resuélvelo manualmente en la ventana: espera hasta 120 segundos por defecto. No hay técnicas para eludir bloqueos. El perfil dedicado `./chrome_profile_pruebas` conserva cookies entre pruebas; no uses ese perfil simultáneamente en otra instancia.

## Opciones útiles

```sh
# Comprobar también que la ficha coincide con el nombre esperado:
uv run scrapper_gmaps_pruebas.py --url "URL_DE_MAPS" --name "Biblioteca Iván de Vargas"

# Recorrer los siete días y guardar diagnóstico (captura y etiquetas accesibles):
uv run scrapper_gmaps_pruebas.py --url "URL_DE_MAPS" --weekly --debug

# Procesar un listado local:
uv run scrapper_gmaps_pruebas.py --input bibliotecas.json --weekly
```

`bibliotecas.json` puede ser una lista de URLs o una lista de objetos con `url` y, opcionalmente, `name`:

```json
[
  {"url": "URL_REAL_DE_MAPS", "name": "Nombre de la biblioteca"},
  "OTRA_URL_REAL_DE_MAPS"
]
```

También puedes repetir `--url` o pasar varias URLs como argumentos posicionales. `--profile` cambia la carpeta del perfil, `--output` la carpeta de resultados y `--driver` permite especificar el ejecutable ChromeDriver instalado si Selenium Manager no lo encuentra.

## Resultados

Cada ejecución crea `./resultados_gmaps/<fecha>/` con:

- `lecturas.jsonl`: una línea por ficha procesada, incluyendo errores.
- `resumen.json`: resumen de la ejecución y sus lecturas, fácil de abrir en un editor.
- Con `--debug`, `diagnostico-001.json` con etiquetas accesibles y `diagnostico-001.png` con una captura, y así sucesivamente.

Las lecturas incluyen nombre, URL original y resuelta, hora UTC, porcentaje habitual, porcentaje en vivo, etiquetas usadas y matriz semanal si se pidió y pudo recorrerse. La hora actual y los días se interpretan en `Europe/Madrid`; los índices de hora son 0–23 y los días ISO 1–7 (lunes–domingo). En la matriz, `complete` indica que se recorrieron los siete días; `missing_data_days` enumera los que no tienen porcentajes publicados.

Un valor `null` significa desconocido; `0` solo aparece si Google publica explícitamente 0 %. La popularidad relativa no es aforo certificado. Las clases CSS no se usan para deducir porcentajes y el script no convierte textos como “poco concurrido” en cifras. Si Google no publica gráfica o porcentajes, la ficha se registra con `status: "skipped"` y `reason: "no_popularity_data"`, se incrementa `skipped` en el resumen y se continúa con la siguiente URL sin contarlo como fallo. Las omisiones tampoco escriben valores nulos ni ceros en Supabase en el scraper del proyecto. Un selector ambiguo cuando sí hay barras se mantiene como error de extracción; un bloqueo detiene la ejecución para evitar insistir.

Código de salida 0: ejecución sin errores (también si hay fichas omitidas por falta de datos); 1: alguna ficha falló o Chrome no pudo iniciarse; 2: argumentos o listado inválidos. Las capturas y URLs se guardan solo en tu disco, sin subirse a ningún servicio.

## Prueba totalmente offline

Sin abrir Chrome ni instalar Selenium, crea `etiquetas.json`:

```json
["0% busy at 9 AM", "Currently 50% busy, usually 30% busy at 2 PM"]
```

```sh
python3 scrapper_gmaps_pruebas.py --parse-labels etiquetas.json
```

Este modo imprime la matriz diaria y el valor en vivo, para comprobar el parser. También acepta los archivos de diagnóstico con la clave `aria_labels`. Se ha probado copiando el archivo fuera del proyecto y ejecutándolo con Python en modo aislado. La navegación real de Google depende de la disponibilidad de su gráfica y no queda garantizada por las pruebas offline.
