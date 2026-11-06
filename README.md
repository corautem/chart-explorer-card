# <img src="https://raw.githubusercontent.com/corautem/chart-explorer-card/main/docs/images/icon-128.png" alt="" width="40" height="40" align="top"> Chart Explorer Card

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/corautem)

A Home Assistant dashboard card for exploring history: lines, stacked areas, bars, pies and hour-by-day heatmaps, with on/off and status entities as coloured strips. A one-row toolbar picks the time window, you drag and pinch to move through time, and the download button saves what is shown as CSV or PNG.

![The card in use: picking 7 days from the Presets menu, dragging, zooming, hovering, fading a line and opening the download menu](docs/images/card-demo.gif)

## Features

- **Eight ways to draw history:** lines, stacked areas, bars per hour, day, week or month, pie, donut, heatmaps of numbers or of states, and timeline strips or shaded bands for entities such as a heat pump status or a door.
- **Ratios such as a heat pump's COP:** one meter's rise divided by others' per bar, with the whole window's ratio above the chart and the ratio so far as a line.
- **Forecasts and other lists:** the values in a list kept in an attribute, such as a solar forecast or electricity prices, are drawn into the future, each with its own colour, line and fill, and with shaded ranges between them.
- **Time controls in one row:** previous and next, Now, and a Presets menu with quick ranges from 1 hour to 1 year, presets such as Today or Last month, spans across the past and the future (12 hours back to 48 ahead, or today and the next two days), and a custom range.
- **Drag to move, pinch to zoom:** the card loads finer data as you zoom in; a double-tap goes back.
- **Values that follow the cursor:** each entity's value sits above the chart in its colour; tap a name to fade that entity.
- **Export:** a CSV of exactly what is shown, or a PNG with the title and legend.
- **Visual editor** for every setting, and **light by default:** only the chart parts in use are bundled, animations are off, and nothing redraws while the card is off-screen.

It brings a time-range toolbar, zooming and export into a dashboard card, so history can be browsed without leaving the dashboard. Charts are drawn with [Apache ECharts](https://echarts.apache.org/) 6. Version 0.6.2 is the first public release.

## Chart types

![The eight chart types: lines, stacked areas, bars, pie, donut, heatmaps of a number and of states, and timeline strips with a band](docs/images/chart-types.png)

| `chart_type` | Draws |
|---|---|
| `line` (default) | One line per entity. Entities with states draw as strips under the chart, or as shaded bands behind the lines. |
| `area` | The lines stacked as filled areas. |
| `bar` | One bar per hour, day, week or month; meters show how much they rose. |
| `pie`, `donut` | Each entity's share of the window; an entity with states gets a pie of the time spent in each state. |
| `heatmap` | One entity, days across and hours down, each hour coloured by its value or by the state that held longest. |

A picture and an example for each: [Chart types](docs/chart-types.md).

## Installing

### HACS

From Home Assistant 2026.11, HACS is built in as the **Marketplace**.

[![Open this repository in HACS on your Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=corautem&repository=chart-explorer-card&category=plugin)

The button opens the card's page in HACS on your Home Assistant, after asking to add it as a custom repository. Select **Download** there and reload the browser. Or add it yourself:

1. In Home Assistant, open **HACS**, then the three-dot menu → **Custom repositories**.
2. Paste `https://github.com/corautem/chart-explorer-card`, choose the type **Dashboard**, and select **Add**.
3. Find **Chart Explorer Card** in HACS, open it and select **Download**. HACS adds the resource entry.
4. Reload the browser.

<details>
<summary><b>By hand</b></summary>

1. Download both files from the [latest release](https://github.com/corautem/chart-explorer-card/releases/latest): `chart-explorer-card.js` (the card) and `chart-explorer-card-editor.js` (the visual editor, loaded only when you edit a card).
2. Copy them into your Home Assistant configuration folder, in `/config/www/chart-explorer-card/`.
3. In Home Assistant, open **Settings → Dashboards**, then the three-dot menu → **Resources** → **Add resource**. (The Resources entry appears only with **Advanced mode** on in your user profile.)
   - URL: `/local/chart-explorer-card/chart-explorer-card.js?v=0.8.3`
   - Type: **JavaScript module**
4. Reload the browser.

When you copy a newer release, raise the `?v=` number in the resource URL so browsers fetch the new files. The editor file is loaded with the same number, so only the card needs a resource entry.

</details>

## Getting started

Add **Chart Explorer Card** from the card picker and choose entities in the visual editor, or start from YAML:

```yaml
type: custom:chart-explorer-card
title: Heating
entities:
  - sensor.flow_temperature
  - sensor.return_temperature
  - binary_sensor.heating
```

![The visual editor beside the card: adding an entity, then the General, Visual and Advanced tabs](docs/images/editor-demo.gif)

*Recorded on the card's test page with made-up data; in Home Assistant the editor shows its usual switches and drop-downs.*

The editor saves only what differs from the defaults, so the YAML stays short. Every option is listed in [Options](docs/options.md).

## Using the card

- **Toolbar:** ‹ › move the window by its own length, Now returns to the present, the Presets menu picks a window (quick ranges at its top), the dates open a custom range, and the download button saves a CSV or PNG.
- **Moving and zooming:** drag sideways to move through time; pinch, or hold Ctrl and use the mouse wheel, to zoom; hold Shift and drag to zoom into a part; double-click or double-tap to go back.
- **Values:** hover over or tap the chart to see the readings at that moment; tap a value for the entity's details; tap a name to fade the entity and leave it out of the CSV.
- **Your formats:** dates, times and numbers follow your Home Assistant profile (language, 12- or 24-hour clock, number format, first day of the week), in your device's time zone.

![The Presets menu open: quick ranges at the top, then Today, Yesterday and the other entries, and Custom at the end](docs/images/presets-menu.png)

More on each control: [Using the card](docs/usage.md).

## Examples

<details>
<summary><b>Heating with a shaded band and the heat pump status</b></summary>

```yaml
type: custom:chart-explorer-card
title: Heat pump
entities:
  - entity: sensor.flow_temperature
    name: Flow
  - entity: binary_sensor.heating
    name: Heating
    type: band
  - entity: sensor.heat_pump_status
    name: Status
    state_colors:
      standby: "#9e9e9e"
```

![A temperature line with the heating periods shaded behind it and the heat pump status as a strip underneath](docs/images/card.png)

</details>

<details>
<summary><b>Energy per day this week</b></summary>

```yaml
type: custom:chart-explorer-card
title: Energy per day
chart_type: bar
default_range: this_week
entities:
  - entity: sensor.heat_pump_energy
    name: Heat pump
  - entity: sensor.hot_water_energy
    name: Hot water
```

![Energy per day for two meters, side by side](docs/images/bar.png)

</details>

<details>
<summary><b>A week of status, hour by hour</b></summary>

```yaml
type: custom:chart-explorer-card
title: Heat pump status by hour
chart_type: heatmap
default_range: 7d
entities:
  - entity: sensor.heat_pump_status
    name: Status
```

![A week of heat pump status, each hour in the colour of its main state](docs/images/heatmap-states.png)

</details>

<details>
<summary><b>History and a forecast in one window</b></summary>

From 12 hours ago to 48 hours ahead: a battery's recorded level, a planner's forecast from its `results` map, and the forecast made 8 hours earlier moved with `time_shift` to line up. See [History and forecast in one window](docs/chart-types.md#history-and-forecast-in-one-window).

```yaml
type: custom:chart-explorer-card
title: Battery forecast
default_range: -12h+60h
entities:
  - entity: sensor.home_battery_stored_energy
    name: Actual
    curve: step
  - entity: planner.battery_stored_energy_forecast
    attribute:
      name: results
      values: [{ key: value, name: Forecast, line_style: dashed }]
  - entity: planner.battery_stored_energy_forecast_8h_ago
    name: 8 hours ago
    time_shift: -8h
```

![A battery's stored energy: the actual level up to now, the planner's forecast after it, and the forecast made 8 hours earlier, shifted to line up](docs/images/battery-forecast.png)

</details>

<details>
<summary><b>A heat pump's COP per day</b></summary>

Heat delivered divided by electricity used, each from its meter, for space heating, hot water and both together. See [Ratios](docs/chart-types.md#ratios-such-as-a-heat-pumps-cop).

```yaml
type: custom:chart-explorer-card
title: Heat pump COP
chart_type: bar
period: day
default_range: this_week
entities:
  - entity: sensor.heat_pump_heat_space_heating
    divide_by: sensor.heat_pump_electricity_space_heating
    name: Heating
  - entity: sensor.heat_pump_heat_hot_water
    divide_by: sensor.heat_pump_electricity_hot_water
    name: Hot water
  - entity: sensor.heat_pump_heat_space_heating
    add: [sensor.heat_pump_heat_hot_water]
    divide_by: [sensor.heat_pump_electricity_space_heating, sensor.heat_pump_electricity_hot_water]
    name: Both
```

![Daily COP bars for space heating, hot water and both together this week](docs/images/cop.png)

</details>

<details>
<summary><b>A solar forecast beside the measured power</b></summary>

The forecast comes from the list in the forecast sensor's `detailedForecast` attribute, as Solcast and Predbat keep it. In the editor, set **Draw from** to that attribute and switch on the values to draw. See [Forecasts and other lists](docs/chart-types.md#forecasts-and-other-lists-from-attributes).

```yaml
type: custom:chart-explorer-card
title: Solar forecast
default_range: today
entities:
  - entity: sensor.solar_power
    name: Solar power
  - entity: sensor.pv_forecast_today
    attribute:
      name: detailedForecast
      values:
        - key: pv_estimate
          name: Forecast
          line_style: dashed
        - key: pv_estimate90
          name: Forecast 90%
          line_style: none
          fill: pv_estimate10
          show_in_header: false
```

![Measured solar power with the forecast as a dashed line and a shaded range from the low to the high estimate](docs/images/forecast.png)

</details>

<details>
<summary><b>A clean card: the value only, toolbar at the bottom without dates</b></summary>

```yaml
type: custom:chart-explorer-card
toolbar_position: bottom
show_range_label: false
show_names: false
entities:
  - entity: sensor.outdoor_temperature
    fill: true
```

![A dark card with one filled temperature line, the value above it without a name, and the toolbar at the bottom](docs/images/toolbar-bottom.png)

</details>

<details>
<summary><b>A floating tooltip, with the values under the chart</b></summary>

```yaml
type: custom:chart-explorer-card
title: Temperatures
tooltip: true
values_placement: below
entities:
  - sensor.flow_temperature
  - sensor.return_temperature
  - sensor.outdoor_temperature
```

![A dark card with three temperature lines, a box beside the cursor listing each value at that moment, and the current values under the chart](docs/images/tooltip.png)

</details>

## Troubleshooting

- **The card or the editor still shows an older version.** Reload the browser. If you installed by hand, raise the `?v=` number in the resource URL.
- **An entity with states draws as a line.** Set `type: timeline` on it. The card decides from the entity's attributes and history, and a sensor that reports numbers is drawn as a line.
- **Older history looks smoother than recent history.** For entities with long-term statistics, windows longer than 24 hours are drawn from 5-minute, hourly, daily or weekly averages instead of every recorded change. See [Data and export](docs/data-and-export.md).
- **A timeline or a heatmap of states stops after some days.** States come from raw history, which the recorder keeps for 10 days unless `purge_keep_days` is changed.

## Documentation

- [Chart types](docs/chart-types.md): a picture and an example for each chart type, forecasts and other lists from attributes, entities with states, bands and state colours.
- [Using the card](docs/usage.md): the toolbar, the values row, moving and zooming.
- [Options](docs/options.md): every card and entity option, and the visual editor's tabs.
- [Data and export](docs/data-and-export.md): where the data comes from, and what the CSV and PNG contain.
- [Development](docs/development.md): building and testing the card.

## Support

I build Chart Explorer Card in my spare time. If it's useful to you, a star on GitHub (the Star button at the top of the repository page) helps other people find it. If you'd like to support the work, you can do so through [GitHub Sponsors](https://github.com/sponsors/corautem) or on [Ko-fi](https://ko-fi.com/corautem).

- **Bugs and feature ideas:** [GitHub issues](https://github.com/corautem/chart-explorer-card/issues).
- **Questions, setups and discussion:** the [Home Assistant Community thread](https://community.home-assistant.io/t/chart-explorer-card-history-forecasts-and-ratios-with-time-controls-in-one-row/1032906).

## Licence

Copyright (C) 2026 the Chart Explorer Card contributors.

Chart Explorer Card is free software: you can redistribute it and/or modify it under the terms of version 3 of the GNU General Public License as published by the Free Software Foundation (GPL-3.0-only). It is distributed in the hope that it will be useful, but without any warranty; see the [GNU General Public License](LICENSE) for details.

The built files include [Apache ECharts](https://github.com/apache/echarts) (Apache License 2.0, with code from [d3](https://github.com/d3/d3) under the BSD 3-Clause License), [ZRender](https://github.com/ecomfe/zrender) and [Lit](https://github.com/lit/lit) (BSD 3-Clause License), [tslib](https://github.com/microsoft/tslib) (0BSD) and icon paths from [Material Design Icons](https://github.com/Templarian/MaterialDesign) (Apache License 2.0). Their licence texts are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and a short notice sits at the top of each built file.
