// Stand-ins for Home Assistant's ha-form and entity picker on the test page,
// so the visual editor can be clicked through. Plain inputs, each marked with
// data-field="<name>"; the real elements look and behave like Home Assistant.

type Schema = {
  name: string;
  type?: string;
  schema?: Schema[];
  selector?: Record<string, Record<string, unknown>>;
};
type Option = string | { value: string; label: string };

const hex = (rgb: unknown) =>
  Array.isArray(rgb) ? `#${rgb.map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : '#000000';
const rgb = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const optionValue = (o: Option) => (typeof o === 'string' ? o : o.value);
const optionLabel = (o: Option) => (typeof o === 'string' ? o : o.label);

class FakeHaForm extends HTMLElement {
  hass?: { states: Record<string, unknown> };
  computeLabel?: (s: Schema) => string;
  computeHelper?: (s: Schema) => string | undefined;
  private fields: Schema[] = [];
  private queued = false;

  // Like the real ha-form, a new field list or new data redraws the form.
  set schema(value: Schema[]) {
    this.fields = value ?? [];
    this.queue();
  }
  get schema() {
    return this.fields;
  }

  private queue() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.render();
    });
  }
  private current: Record<string, unknown> = {};
  // Inputs from an earlier render can still fire "change" when removed; ignore them.
  private generation = 0;

  set data(value: Record<string, unknown>) {
    this.current = value ?? {};
    this.queue();
  }
  get data() {
    return this.current;
  }

  connectedCallback() {
    this.render();
  }

  private emit(name: string, value: unknown, generation = this.generation) {
    if (generation !== this.generation) return;
    this.current = { ...this.current, [name]: value };
    this.dispatchEvent(new CustomEvent('value-changed', { detail: { value: this.current }, bubbles: true, composed: true }));
  }

  private render() {
    if (!this.isConnected) return;
    this.generation++;
    this.replaceChildren(...this.fields.map((s) => this.field(s)));
  }

  private field(s: Schema): HTMLElement {
    const gen = this.generation;
    const emit = (name: string, value: unknown) => this.emit(name, value, gen);
    if (s.type === 'grid') {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px';
      row.append(...(s.schema ?? []).map((c) => this.field(c)));
      return row;
    }
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;flex-direction:column;flex:1;font-size:12px;margin:4px 0;gap:2px';
    wrap.append(document.createTextNode(this.computeLabel?.(s) ?? s.name));
    const selector = s.selector ?? {};
    const value = this.current[s.name];
    let input: HTMLElement;
    if ('boolean' in selector) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(value);
      box.onchange = () => emit(s.name, box.checked);
      input = box;
    } else if ('number' in selector) {
      const box = document.createElement('input');
      box.type = 'number';
      box.value = value === undefined || value === null ? '' : String(value);
      box.onchange = () => emit(s.name, box.value === '' ? undefined : Number(box.value));
      input = box;
    } else if ('select' in selector && selector.select.multiple) {
      const list = document.createElement('div');
      const chosen = new Set((value as string[] | undefined) ?? []);
      for (const option of (selector.select.options as Option[]) ?? []) {
        const item = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = optionValue(option);
        box.checked = chosen.has(box.value);
        box.onchange = () => {
          if (box.checked) chosen.add(box.value);
          else chosen.delete(box.value);
          emit(s.name, [...chosen]);
        };
        item.append(box, document.createTextNode(` ${optionLabel(option)} `));
        list.append(item);
      }
      input = list;
    } else if ('select' in selector) {
      const box = document.createElement('select');
      const options = (selector.select.options as Option[]) ?? [];
      for (const option of options) box.add(new Option(optionLabel(option), optionValue(option)));
      if (value !== undefined && !options.some((o) => optionValue(o) === value)) box.add(new Option(String(value), String(value)));
      box.value = String(value ?? '');
      box.onchange = () => emit(s.name, box.value);
      input = box;
    } else if ('color_rgb' in selector) {
      const box = document.createElement('input');
      box.type = 'color';
      box.value = hex(value);
      box.onchange = () => emit(s.name, rgb(box.value));
      input = box;
    } else if ('entity' in selector) {
      const box = document.createElement('input');
      const list = document.createElement('datalist');
      list.id = `entities-${Math.random().toString(36).slice(2)}`;
      for (const id of Object.keys(this.hass?.states ?? {})) list.append(new Option(id, id));
      box.setAttribute('list', list.id);
      box.placeholder = 'Search entities';
      box.value = String(value ?? '');
      box.onchange = () => emit(s.name, box.value);
      wrap.append(list);
      input = box;
    } else {
      const box = document.createElement('input');
      box.value = String(value ?? '');
      box.onchange = () => emit(s.name, box.value);
      input = box;
    }
    input.dataset.field = s.name;
    wrap.append(input);
    const help = this.computeHelper?.(s);
    if (help) {
      const small = document.createElement('small');
      small.dataset.helper = s.name;
      small.style.color = 'var(--secondary-text-color)';
      small.textContent = help;
      wrap.append(small);
    }
    return wrap;
  }
}

customElements.define('ha-form', FakeHaForm);
customElements.define('ha-entity-picker', class extends HTMLElement {});

export {};
