// Only the ECharts parts the card draws with, so the bundle stays small. The
// floating tooltip and the now line are drawn without ECharts' tooltip and
// marker-line components, which would add about 40 KB. Bars, bands, timeline
// strips and heatmap cells are all custom series.
import { init, use } from 'echarts/core';
import { CustomChart, LineChart, PieChart } from 'echarts/charts';
import { AxisPointerComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([LineChart, CustomChart, PieChart, GridComponent, AxisPointerComponent, CanvasRenderer]);

export { init };
export type { EChartsType } from 'echarts/core';
