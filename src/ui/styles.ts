import { css } from 'lit';

export const cardStyles = css`
  :host {
    display: block;
  }
  ha-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    padding: 8px 12px 6px;
    overflow: visible;
  }
  .title {
    font-size: 16px;
    font-weight: 500;
    line-height: 1.3;
    color: var(--primary-text-color);
    padding: 2px 0 4px;
  }

  /* Toolbar */
  .toolbar-wrap {
    position: relative;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 34px;
    overflow: hidden;
  }
  .bottom .toolbar-wrap {
    padding-top: 4px;
  }
  button {
    font: inherit;
    color: var(--primary-text-color);
    background: none;
    border: 0;
    border-radius: 6px;
    height: 28px;
    padding: 0 8px;
    cursor: pointer;
    white-space: nowrap;
    flex: none;
    font-size: 13px;
  }
  button:hover {
    background: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.06);
  }
  button:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: -2px;
  }
  button.active {
    color: var(--primary-color);
    background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.14);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .icon-button {
    width: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  .with-icon {
    display: inline-flex;
    align-items: center;
    padding-right: 2px;
  }
  .label {
    flex: 1 0 auto;
    text-align: center;
    color: var(--primary-text-color);
    padding: 0 6px;
  }
  .stacked .label {
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    font-size: 12px;
    line-height: 1.2;
    height: 32px;
  }
  .stacked .label span {
    display: block;
  }
  .shrink .label {
    flex: 1 1 auto;
    min-width: 0;
  }
  .shrink .label span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .quick {
    display: flex;
    flex: none;
  }
  .quick button {
    padding: 0 6px;
  }
  .folded .quick {
    display: none;
  }

  /* Menus and the custom range */
  .menu,
  .popover {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 8;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    border: 1px solid var(--divider-color);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    padding: 4px 0;
    min-width: 170px;
    box-sizing: border-box;
  }
  /* The middle list scrolls; quick ranges and Custom stay in view. */
  .menu {
    display: flex;
    flex-direction: column;
  }
  .menu-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .menu-top {
    flex: none;
    border-bottom: 1px solid var(--divider-color);
    padding-bottom: 2px;
    margin-bottom: 2px;
  }
  .menu-bottom {
    flex: none;
    border-top: 1px solid var(--divider-color);
    padding-top: 2px;
    margin-top: 2px;
  }
  .popover {
    overflow-y: auto;
  }
  .bottom .menu,
  .bottom .popover {
    top: auto;
    bottom: 100%;
  }
  .menu button {
    display: flex;
    width: 100%;
    justify-content: flex-start;
    border-radius: 0;
    height: 32px;
    padding: 0 14px;
  }
  .menu .section {
    font-size: 11px;
    color: var(--secondary-text-color);
    padding: 6px 14px 2px;
  }
  .menu .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 2px 10px 4px;
  }
  .menu .chips button {
    width: auto;
    padding: 0 8px;
    border-radius: 6px;
    height: 28px;
  }
  .menu hr {
    border: 0;
    border-top: 1px solid var(--divider-color);
    margin: 4px 0;
  }
  .popover {
    padding: 10px 12px;
    min-width: 240px;
  }
  .popover label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--secondary-text-color);
    margin-bottom: 8px;
  }
  .popover input {
    font: inherit;
    font-size: 14px;
    color: var(--primary-text-color);
    background: var(--secondary-background-color, transparent);
    border: 1px solid var(--divider-color);
    border-radius: 6px;
    padding: 4px 6px;
    color-scheme: light dark;
  }
  .popover .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .popover .error {
    color: var(--error-color, #db4437);
    font-size: 12px;
    margin-bottom: 6px;
  }

  /* Values above the chart */
  .values {
    display: flex;
    flex-wrap: wrap;
    gap: 2px var(--values-gap, 18px);
    padding: 4px 0 2px;
  }
  .align-center {
    justify-content: center;
  }
  .align-right {
    justify-content: flex-end;
  }
  .align-spread {
    justify-content: space-between;
  }
  .align-even {
    justify-content: space-evenly;
  }
  /* Hidden dates keep their space, empty, so nothing else moves into it. */
  .label.placeholder {
    visibility: hidden;
    pointer-events: none;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    white-space: nowrap;
    font-size: 13px;
    height: 28px;
  }
  .stacked .label.placeholder {
    flex-direction: column;
    font-size: 12px;
  }
  .no-menu .quick {
    flex: 0 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pie-name {
    position: absolute;
    top: 2px;
    transform: translateX(-50%);
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--secondary-text-color);
    font-size: 12px;
    pointer-events: none;
    white-space: nowrap;
  }
  .heat-scale {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 0 12px 8px;
    color: var(--secondary-text-color);
    font-size: 11px;
  }
  .heat-scale i {
    width: 80px;
    height: 8px;
    border-radius: 4px;
  }
  .heat-scale.states {
    flex-wrap: wrap;
    column-gap: 12px;
    row-gap: 2px;
  }
  .heat-scale .state-key {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .heat-scale .state-key i {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .heat-scale .state-key i.striped {
    background: repeating-linear-gradient(
      135deg,
      var(--secondary-text-color) 0 1px,
      transparent 1px 4px
    );
    opacity: 0.7;
  }
  .axis-unit {
    position: absolute;
    top: 4px;
    transform: translateX(-50%);
    color: var(--secondary-text-color);
    pointer-events: none;
    white-space: nowrap;
    line-height: 1.2;
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }
  .item button {
    height: auto;
    padding: 0 2px;
    border-radius: 4px;
    text-align: left;
  }
  .item .value {
    color: var(--item-color);
    font-size: var(--value-size, 22px);
    font-weight: 500;
    line-height: 1.2;
  }
  .item .unit {
    font-size: 0.6em;
    font-weight: 400;
    margin-left: 2px;
  }
  .item .value.text {
    font-size: calc(var(--value-size, 22px) * 0.72);
  }
  /* Where the value sits relative to the name. */
  .pos-below .item {
    flex-direction: column-reverse;
  }
  /* The name lines up with its value when one sits above the other. */
  .name-center:is(.pos-above, .pos-below) .item {
    align-items: center;
  }
  .name-right:is(.pos-above, .pos-below) .item {
    align-items: flex-end;
  }
  .values.below {
    padding: 4px 0 0;
  }
  .pos-left .item,
  .pos-right .item {
    flex-direction: row;
    align-items: baseline;
    gap: 6px;
  }
  .pos-right .item {
    flex-direction: row-reverse;
  }
  .item .name {
    color: var(--secondary-text-color);
    font-size: var(--name-size, 12px);
    line-height: 1.4;
    max-width: 16em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item.faded .value {
    opacity: 0.45;
  }
  .item.faded .name {
    text-decoration: line-through;
  }
  .item .problem {
    color: var(--secondary-text-color);
  }

  /* Chart */
  .chart-wrap {
    position: relative;
    flex: 1 1 var(--chart-height, 250px);
    min-height: min(120px, var(--chart-height, 250px));
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }
  .drag-pan {
    cursor: grab;
  }
  .drag-pan:active {
    cursor: grabbing;
  }
  .drag-zoom {
    cursor: crosshair;
  }
  .chart {
    position: absolute;
    inset: 0;
    transition: opacity 0.2s;
  }
  .chart.dim {
    opacity: 0.45;
  }
  .selection {
    position: absolute;
    top: 0;
    bottom: 22px;
    display: none;
    pointer-events: none;
    background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.15);
    border-left: 1px solid var(--primary-color);
    border-right: 1px solid var(--primary-color);
  }
  .loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    overflow: hidden;
    z-index: 3;
    border-radius: 2px;
  }
  .loading-bar::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 35%;
    background: var(--primary-color);
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .loading-bar::before {
      animation-duration: 3s;
    }
  }
  .tooltip {
    position: absolute;
    top: 8px;
    z-index: 4;
    pointer-events: none;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    border: 1px solid var(--divider-color);
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    padding: 6px 8px;
    font-size: 12px;
    line-height: 1.5;
    white-space: nowrap;
  }
  .tooltip-time {
    color: var(--secondary-text-color);
    margin-bottom: 2px;
  }
  .tooltip-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tooltip-row .key {
    width: 12px;
    height: 2px;
    border-radius: 1px;
  }
  .tooltip-name {
    flex: 1;
    margin-right: 8px;
  }
  .message {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    pointer-events: none;
    color: var(--secondary-text-color);
    font-size: 14px;
    text-align: center;
    padding: 0 16px;
  }
  .message button {
    pointer-events: auto;
    color: var(--primary-color);
    border: 1px solid var(--primary-color);
  }
`;
