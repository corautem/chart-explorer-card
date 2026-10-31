# Data and export

## Where the data comes from

Raw history holds every recorded change, for as long as the recorder keeps it (10 days by default, the recorder's `purge_keep_days`). Entities with a `state_class` also get long-term statistics: 5-minute averages, kept as long as raw history, and hourly averages for longer. The card picks the source by window length:

| Window | Data |
|---|---|
| up to 24 hours | raw history |
| up to 10 days | 5-minute statistics |
| up to 90 days | hourly statistics |
| up to 3 years | daily statistics |
| longer | weekly statistics |

Home Assistant does not tell cards how long the recorder keeps raw history, so the card works it out. Where raw history or 5-minute statistics no longer reach back to the start of a window, the missing part is filled from hourly statistics. The card then remembers where raw history begins and asks for statistics straight away for older windows.

When statistics are drawn up to the present, the time after the newest bucket comes from raw history, so the line reaches now. Entities without long-term statistics (no `state_class`) always use raw history and show nothing beyond what the recorder keeps.

New states arrive through the connection the dashboard already has; the card does not poll. Windows that include the present update as states change, at most every 10 seconds in lightweight mode.

**Bars, pies and heatmaps** use one value per period from the long-term statistics: how much a meter rose (Home Assistant's `change`), or the average. Hours, days, weeks and months follow your device's time zone and week start. Home Assistant compiles statistics once an hour, so the hour in progress comes from raw history, and the current bar keeps growing; the card reloads it every 5 minutes in lightweight mode, every minute otherwise. Entities without statistics are averaged from raw history.

**States** come from raw history only, so timelines and heatmaps of states reach back as far as the recorder keeps it.

## Export

**CSV** holds the current window (zoomed if you zoomed), the entities that are not faded, and every loaded point in the window, before any thinning for drawing.

- The first column is `time` in your device's local time, as `YYYY-MM-DD HH:mm:ss`; then one column per entity headed `Name (unit)`.
- The first row is at the window start and holds the values the lines enter the window with.
- After that, each row is a moment when at least one entity changed. Other cells in the row stay blank (`csv_fill: previous` repeats the last value instead).
- Entities with states get their state as text, such as `standby`.
- Bars and heatmaps give one row per period (hour, day, week or month), with the time the period starts. A heatmap of states gives the state that held longest in each hour, then one column per state with its minutes in that hour.
- A pie gives one row per slice with `name`, `value`, `unit` and `percent`; for an entity with states, the hours spent in each state.
- The file is UTF-8 with a byte order mark, so Excel reads `°C` correctly. For European Excel, use `csv_separator: ";"` and `csv_decimal: ","`.

**PNG** is the chart at double resolution with the title, the range and the coloured entity names above it, and the colour key or the list of states for a heatmap.

Files are named after the card title (or `chart`) with the start and end date, for example `Heating_2026-10-26_2026-11-01.csv`. Windows that do not start and end at midnight add the time: `Heating_2026-10-30_0800_2026-10-30_1430.csv`.

In the Home Assistant Companion app, where ordinary downloads may not work, the card offers the phone's share sheet instead.
