"""Strict conversion of user-provided long-form library/hour catalogs to the master schema."""

import unicodedata


def import_unified_centers(records: list[dict], columns: list[str]) -> list[dict]:
    expected = set(
        "biblioteca dia horario hora ocupacion_pct municipio zona_distrito direccion codigo_postal telefono notas_horario tiene_popular_times".split()
    )
    labels = ("lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo")
    days = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")
    groups = {}
    for row in records:
        if set(row) != expected or not row["biblioteca"].strip():
            raise ValueError("Columnas o nombre inválidos en CSV unificado")
        groups.setdefault(row["biblioteca"].strip(), []).append(row)
    result = []
    for name, rows in groups.items():
        if len(rows) != 126:
            raise ValueError(f"Se requieren 126 franjas para {name}")
        for key in expected - {"dia", "horario", "hora", "ocupacion_pct"}:
            if len({r[key] for r in rows}) != 1:
                raise ValueError(f"Metadatos inconsistentes: {name}, {key}")
        popular = rows[0]["tiene_popular_times"].lower()
        if popular not in {"true", "false"}:
            raise ValueError("Indicador de Popular Times inválido")
        output = dict.fromkeys(columns, "")
        output.update(
            nombre=name,
            direccion=rows[0]["direccion"],
            telefono=rows[0]["telefono"],
            num_resenas="0",
            tipo="Centro cultural" if name.startswith("Centro") else "Biblioteca pública",
        )
        schedules, seen = {}, set()
        for r in rows:
            label = (
                unicodedata.normalize("NFKD", r["dia"]).encode("ascii", "ignore").decode().lower()
            )
            if label not in labels:
                raise ValueError("Día desconocido")
            day = days[labels.index(label)]
            hour, minute = map(int, r["hora"].split(":"))
            if minute or hour not in range(6, 24) or (day, hour) in seen:
                raise ValueError("Franja duplicada o inválida")
            seen.add((day, hour))
            schedule = r["horario"].replace(",", " /")
            if day in schedules and schedules[day] != schedule:
                raise ValueError("Horario inconsistente")
            schedules[day] = schedule
            value = r["ocupacion_pct"].strip()
            if popular == "false" and value.lower() not in {"", "nan", "null"}:
                raise ValueError("Curva marcada como ausente contiene observaciones")
            output[f"ocupacion_{day}_{hour:02}"] = value
        for day in days:
            output[f"horario_{day}"] = schedules[day]
        result.append(output)
    return result
