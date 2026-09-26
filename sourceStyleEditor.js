(() => {
  'use strict';

  const FONTS = [
    'Arial', 'Arial Black', 'Book Antiqua', 'Bookman Old Style',
    'Calibri', 'Cambria', 'Candara', 'Century Gothic',
    'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
    'Courier New', 'Franklin Gothic Medium', 'Garamond', 'Georgia',
    'Gil Sans MT', 'Impact', 'Leelawadee UI', 'Lucida Console',
    'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype',
    'Segoe UI', 'Segoe UI Light', 'Tahoma', 'Times New Roman',
    'Trebuchet MS', 'Verdana'
  ];

  const TEXT_SECTIONS = [
    { key: 'verseText', tab: 'verses', title: 'Main Text', bold: true, italic: true, align: true, spacing: true, shadow: true, outline: true },
    { key: 'verseNumber', tab: 'verses', title: 'Verse Number', subtitle: 'Top-left', size: 'number', bold: true, shadow: true, outline: true },
    { key: 'verseSubscript', tab: 'verses', title: 'Inline Verse Numbers', size: 'subscript', shadow: true },
    { key: 'verseReference', tab: 'verses', title: 'Verse Reference', subtitle: 'Bottom-right', size: 'reference', bold: true, italic: true, shadow: true, outline: true },
    { key: 'songText', tab: 'songs', title: 'Song Text', subtitle: 'Lyrics', bold: true, italic: true, align: true, spacing: true, shadow: true, outline: true, songInline: true },
    { key: 'songReference', tab: 'songs', title: 'Song Reference', subtitle: 'Bottom-right', size: 'reference', bold: true, italic: true, shadow: true, outline: true }
  ];

  const TEXT_DEFAULTS = {
    color: '#ffffff',
    fontFamily: 'Arial',
    sizeEm: '',
    bold: false,
    italic: false,
    textAlign: 'center',
    letterSpacing: 0,
    shadowColor: '#000000',
    shadowBlur: 0,
    shadowX: 0,
    shadowY: 0,
    strokeColor: '#000000',
    strokeWidth: 0
  };

  const GLOBAL_DEFAULTS = {
    overlayOpacity: 0.4,
    bgBlur: 0,
    lineHeight: 1.2,
    verticalPosition: 'center',
    safeAreaX: 0.04,
    safeAreaY: 0.04,
    safeAreaW: 0.92,
    safeAreaH: 0.92,
    songInline: false
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function cssValue(css, property) {
    const escaped = property.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const match = String(css || '').match(new RegExp('(?:^|;)\\s*' + escaped + '\\s*:\\s*([^;]+)', 'i'));
    return match ? match[1].trim() : undefined;
  }

  function numberValue(css, property) {
    const value = Number.parseFloat(cssValue(css, property));
    return Number.isFinite(value) ? value : undefined;
  }

  function parseText(css) {
    const source = String(css || '');
    const size = source.match(/font-size\s*:\s*([\d.]+)(em|px)/i);
    const weight = cssValue(source, 'font-weight');
    const fontStyle = cssValue(source, 'font-style');
    return {
      color: cssValue(source, 'color'),
      fontFamily: (cssValue(source, 'font-family') || '').replace(/^["']|["']$/g, '') || undefined,
      sizeEm: size ? (size[2].toLowerCase() === 'px' ? String(Number.parseFloat(size[1]) / 86.4) : size[1]) : undefined,
      bold: weight === undefined ? undefined : /^(bold|[6-9]00)$/i.test(weight),
      italic: fontStyle === undefined ? undefined : /^italic$/i.test(fontStyle),
      textAlign: cssValue(source, 'text-align'),
      letterSpacing: numberValue(source, 'letter-spacing'),
      shadowColor: cssValue(source, 'shadow-color'),
      shadowBlur: numberValue(source, 'shadow-blur'),
      shadowX: numberValue(source, 'shadow-x'),
      shadowY: numberValue(source, 'shadow-y'),
      strokeColor: cssValue(source, 'stroke-color'),
      strokeWidth: numberValue(source, 'stroke-width')
    };
  }

  function parseGlobal(css) {
    const source = String(css || '');
    const inline = cssValue(source, 'song-inline');
    return {
      overlayOpacity: numberValue(source, 'overlay-opacity'),
      bgBlur: numberValue(source, 'bg-blur'),
      lineHeight: numberValue(source, 'line-height'),
      verticalPosition: cssValue(source, 'vertical-position'),
      safeAreaX: numberValue(source, 'safe-area-x'),
      safeAreaY: numberValue(source, 'safe-area-y'),
      safeAreaW: numberValue(source, 'safe-area-w'),
      safeAreaH: numberValue(source, 'safe-area-h'),
      songInline: inline === undefined ? undefined : inline === '1'
    };
  }

  function definedOnly(object) {
    const result = {};
    for (const [key, value] of Object.entries(object)) {
      if (value !== undefined && value !== null) result[key] = value;
    }
    return result;
  }

  function makeSelect(options) {
    const select = document.createElement('select');
    for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    return select;
  }

  function makeField(labelText, control, wide) {
    const label = el('label', 'wse-field' + (wide ? ' wse-field-wide' : ''));
    label.append(el('span', '', labelText), control);
    return label;
  }

  function makeRange(labelText, min, max, suffix) {
    const wrap = el('label', 'wse-range-field');
    const title = el('span', '', labelText);
    const row = el('div', 'wse-range-row');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    const output = document.createElement('output');
    input._wseOutput = output;
    input._wseSuffix = suffix || '';
    row.append(input, output);
    wrap.append(title, row);
    return { wrap, input, output };
  }

  function makeToggle(labelText, shortText) {
    const button = el('button', 'wse-toggle');
    button.type = 'button';
    if (shortText) button.append(el('strong', '', shortText));
    button.append(el('span', '', labelText));
    return button;
  }

  function makeSegment(values) {
    const wrap = el('div', 'wse-segmented');
    wrap._wseButtons = [];
    for (const [value, label] of values) {
      const button = el('button', '', label);
      button.type = 'button';
      button.dataset.value = value;
      wrap._wseButtons.push(button);
      wrap.appendChild(button);
    }
    return wrap;
  }

  function sizeOptions(kind) {
    if (kind === 'reference') return [['', 'Default'], ['0.45', 'Small'], ['0.6', 'Medium'], ['0.75', 'Large'], ['0.9', 'X-Large']];
    return [['', 'Default'], ['0.4', 'Small'], ['0.55', 'Medium'], ['0.7', 'Large'], ['0.85', 'X-Large']];
  }

  class SourceStyleEditor {
    constructor(container, onApply) {
      this.container = container;
      this.onApply = typeof onApply === 'function' ? onApply : () => {};
      this.layer = null;
      this.baseline = {};
      this.baselineAvailable = false;
      this.tab = 'verses';
      this.controls = { global: {} };
      this.sections = new Map();
      this.build();
    }

    build() {
      this.container.replaceChildren();

      const header = el('div', 'wse-header');
      const heading = el('div');
      heading.append(el('div', 'wse-eyebrow', 'WORSHIP SOURCE STYLE'));
      this.sourceName = el('h3', '', 'Liturgia Program');
      this.status = el('p', 'helper', 'Connect Worship to load its current defaults.');
      this.status.setAttribute('role', 'status');
      heading.append(this.sourceName, this.status);
      const resetAll = el('button', 'button secondary', 'Use all Worship defaults');
      resetAll.type = 'button';
      resetAll.addEventListener('click', () => {
        if (!this.layer) return;
        this.layer.sourceStyles = {};
        this.onApply(this.layer);
        this.populate();
        this.setStatus('All source style overrides cleared. This source now follows Worship.');
      });
      header.append(heading, resetAll);
      this.container.appendChild(header);

      this.buildGlobalSection();

      const tabs = el('div', 'wse-tabs');
      this.tabButtons = {};
      for (const key of ['verses', 'songs']) {
        const button = el('button', key === this.tab ? 'active' : '', key === 'verses' ? 'Verses' : 'Songs');
        button.type = 'button';
        button.addEventListener('click', () => {
          this.tab = key;
          this.updateTabs();
        });
        this.tabButtons[key] = button;
        tabs.appendChild(button);
      }
      this.container.appendChild(tabs);

      this.panels = {};
      for (const tab of ['verses', 'songs']) {
        const panel = el('div', 'wse-tab-panel' + (tab === this.tab ? ' active' : ''));
        this.panels[tab] = panel;
        this.container.appendChild(panel);
      }

      for (const config of TEXT_SECTIONS) this.buildTextSection(config);
      this.updateTabs();
    }

    buildSectionShell(key, title, subtitle) {
      const section = el('section', 'wse-section');
      section.dataset.section = key;
      const heading = el('div', 'wse-section-heading');
      const label = el('div');
      label.append(el('strong', '', title));
      if (subtitle) label.append(el('span', '', subtitle));
      const reset = el('button', 'button secondary wse-reset-section', 'Use Worship default');
      reset.type = 'button';
      reset.addEventListener('click', () => this.resetSection(key));
      heading.append(label, reset);
      section.appendChild(heading);
      return section;
    }

    buildGlobalSection() {
      const section = this.buildSectionShell('global', 'Canvas & Layout', 'Matches Worship’s style editor');
      section.classList.add('wse-global-section');
      const grid = el('div', 'wse-control-grid');

      const overlay = makeRange('Background overlay', 0, 100, '%');
      this.controls.global.overlayOpacity = overlay.input;
      grid.appendChild(overlay.wrap);

      const blur = makeRange('Background blur', 0, 20, ' px');
      this.controls.global.bgBlur = blur.input;
      grid.appendChild(blur.wrap);

      const lineHeight = makeSelect([['1', '1.0'], ['1.1', '1.1'], ['1.2', '1.2'], ['1.3', '1.3'], ['1.4', '1.4'], ['1.5', '1.5'], ['1.7', '1.7'], ['2', '2.0']]);
      this.controls.global.lineHeight = lineHeight;
      grid.appendChild(makeField('Line height', lineHeight));

      const position = makeSegment([['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']]);
      this.controls.global.verticalPosition = position;
      grid.appendChild(makeField('Vertical position', position, true));
      section.appendChild(grid);

      section.appendChild(el('div', 'wse-subheading', 'Safe Area'));
      const safeGrid = el('div', 'wse-safe-grid');
      for (const [key, label, min, max] of [
        ['safeAreaX', 'Left %', 0, 95],
        ['safeAreaY', 'Top %', 0, 95],
        ['safeAreaW', 'Width %', 5, 100],
        ['safeAreaH', 'Height %', 5, 100]
      ]) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.step = '0.5';
        this.controls.global[key] = input;
        safeGrid.appendChild(makeField(label, input));
      }
      const resetSafe = el('button', 'button secondary', 'Reset safe area');
      resetSafe.type = 'button';
      resetSafe.addEventListener('click', () => {
        this.controls.global.safeAreaX.value = '4';
        this.controls.global.safeAreaY.value = '4';
        this.controls.global.safeAreaW.value = '92';
        this.controls.global.safeAreaH.value = '92';
        this.applyGlobal();
      });
      safeGrid.appendChild(resetSafe);
      section.appendChild(safeGrid);

      const apply = () => this.applyGlobal();
      overlay.input.addEventListener('input', apply);
      blur.input.addEventListener('input', apply);
      lineHeight.addEventListener('change', apply);
      for (const input of [this.controls.global.safeAreaX, this.controls.global.safeAreaY, this.controls.global.safeAreaW, this.controls.global.safeAreaH]) input.addEventListener('input', apply);
      for (const button of position._wseButtons) {
        button.addEventListener('click', () => {
          this.setSegment(position, button.dataset.value);
          apply();
        });
      }

      this.sections.set('global', section);
      this.container.appendChild(section);
    }

    buildTextSection(config) {
      const section = this.buildSectionShell(config.key, config.title, config.subtitle);
      const controls = {};
      this.controls[config.key] = controls;

      const grid = el('div', 'wse-control-grid');
      const color = document.createElement('input');
      color.type = 'color';
      controls.color = color;
      grid.appendChild(makeField('Text color', color));

      const font = makeSelect(FONTS.map((name) => [name, name]));
      controls.fontFamily = font;
      grid.appendChild(makeField('Font', font));

      if (config.size) {
        const size = makeSelect(sizeOptions(config.size));
        controls.sizeEm = size;
        grid.appendChild(makeField('Size', size));
      }

      if (config.spacing) {
        const spacing = makeSelect([['0', 'Default'], ['1', '+1 px'], ['2', '+2 px'], ['3', '+3 px'], ['5', '+5 px'], ['8', '+8 px']]);
        controls.letterSpacing = spacing;
        grid.appendChild(makeField('Letter spacing', spacing));
      }

      const format = el('div', 'wse-format-row');
      if (config.bold) {
        controls.bold = makeToggle('Bold', 'B');
        format.appendChild(controls.bold);
      }
      if (config.italic) {
        controls.italic = makeToggle('Italic', 'I');
        format.appendChild(controls.italic);
      }
      if (config.songInline) {
        controls.songInline = makeToggle('Inline lyrics');
        format.appendChild(controls.songInline);
      }
      if (format.childNodes.length) grid.appendChild(format);

      if (config.align) {
        controls.textAlign = makeSegment([['left', 'Left'], ['center', 'Center'], ['right', 'Right']]);
        grid.appendChild(makeField('Alignment', controls.textAlign, true));
      }

      section.appendChild(grid);

      if (config.shadow) {
        section.appendChild(el('div', 'wse-subheading', 'Shadow'));
        const shadowGrid = el('div', 'wse-control-grid');
        const shadowColor = document.createElement('input');
        shadowColor.type = 'color';
        controls.shadowColor = shadowColor;
        shadowGrid.appendChild(makeField('Shadow color', shadowColor));

        for (const [key, label, min, max] of [
          ['shadowBlur', 'Blur', 0, 30],
          ['shadowX', 'Horizontal offset', -20, 20],
          ['shadowY', 'Vertical offset', -20, 20]
        ]) {
          const range = makeRange(label, min, max, '');
          controls[key] = range.input;
          shadowGrid.appendChild(range.wrap);
        }
        section.appendChild(shadowGrid);
      }

      if (config.outline) {
        section.appendChild(el('div', 'wse-subheading', 'Outline'));
        const outlineGrid = el('div', 'wse-control-grid');
        const strokeColor = document.createElement('input');
        strokeColor.type = 'color';
        controls.strokeColor = strokeColor;
        outlineGrid.appendChild(makeField('Outline color', strokeColor));
        const strokeWidth = makeSelect([['0', 'None'], ['1', '1 px'], ['2', '2 px'], ['3', '3 px'], ['4', '4 px'], ['6', '6 px']]);
        controls.strokeWidth = strokeWidth;
        outlineGrid.appendChild(makeField('Outline width', strokeWidth));
        section.appendChild(outlineGrid);
      }

      const apply = () => this.applyText(config);
      for (const control of Object.values(controls)) {
        if (!control || control._wseButtons) continue;
        const eventName = control.type === 'range' || control.type === 'color' ? 'input' : 'change';
        control.addEventListener(eventName, apply);
      }
      for (const key of ['bold', 'italic', 'songInline']) {
        const button = controls[key];
        if (!button) continue;
        button.addEventListener('click', () => {
          button.classList.toggle('active');
          if (key === 'songInline') this.applyGlobal();
          else apply();
        });
      }
      if (controls.textAlign) {
        for (const button of controls.textAlign._wseButtons) {
          button.addEventListener('click', () => {
            this.setSegment(controls.textAlign, button.dataset.value);
            apply();
          });
        }
      }

      this.sections.set(config.key, section);
      this.panels[config.tab].appendChild(section);
    }

    updateTabs() {
      for (const key of ['verses', 'songs']) {
        this.tabButtons[key].classList.toggle('active', this.tab === key);
        this.panels[key].classList.toggle('active', this.tab === key);
      }
    }

    setLayer(layer) {
      this.layer = layer && layer.type === 'program' ? layer : null;
      this.container.hidden = !this.layer;
      if (!this.layer) return;
      this.sourceName.textContent = this.layer.name || 'Liturgia Program';
      this.populate();
    }

    setBaseline(styles, available) {
      this.baseline = styles && typeof styles === 'object' ? styles : {};
      this.baselineAvailable = !!available;
      this.populate();
    }

    setStatus(message) {
      if (this.status) this.status.textContent = message;
    }

    defaultCssFor(key) {
      if (this.baseline[key]) return this.baseline[key];
      if (key === 'songText') return this.baseline.verseText || '';
      if (key === 'songReference') return this.baseline.verseReference || '';
      return '';
    }

    effectiveText(key) {
      const defaults = { ...TEXT_DEFAULTS, color: key === 'verseSubscript' ? '#dddddd' : '#ffffff' };
      const inherited = definedOnly(parseText(this.defaultCssFor(key)));
      const override = definedOnly(parseText(this.layer && this.layer.sourceStyles ? this.layer.sourceStyles[key] : ''));
      return { ...defaults, ...inherited, ...override };
    }

    effectiveGlobal() {
      const inherited = definedOnly(parseGlobal(this.baseline.global || ''));
      const override = definedOnly(parseGlobal(this.layer && this.layer.sourceStyles ? this.layer.sourceStyles.global : ''));
      return { ...GLOBAL_DEFAULTS, ...inherited, ...override };
    }

    setRange(input, value) {
      input.value = String(value);
      if (input._wseOutput) {
        const text = String(value) + (input._wseSuffix || '');
        input._wseOutput.value = text;
        input._wseOutput.textContent = text;
      }
    }

    setSegment(group, value) {
      if (!group || !group._wseButtons) return;
      for (const button of group._wseButtons) button.classList.toggle('active', button.dataset.value === String(value));
    }

    getSegment(group, fallback) {
      if (!group || !group._wseButtons) return fallback;
      const active = group._wseButtons.find((button) => button.classList.contains('active'));
      return active ? active.dataset.value : fallback;
    }

    populate() {
      if (!this.layer) return;
      this.sourceName.textContent = this.layer.name || 'Liturgia Program';
      const global = this.effectiveGlobal();
      this.setRange(this.controls.global.overlayOpacity, Math.round(global.overlayOpacity * 100));
      this.setRange(this.controls.global.bgBlur, global.bgBlur);
      this.controls.global.lineHeight.value = String(global.lineHeight);
      this.setSegment(this.controls.global.verticalPosition, global.verticalPosition);
      this.controls.global.safeAreaX.value = String(Math.round(global.safeAreaX * 1000) / 10);
      this.controls.global.safeAreaY.value = String(Math.round(global.safeAreaY * 1000) / 10);
      this.controls.global.safeAreaW.value = String(Math.round(global.safeAreaW * 1000) / 10);
      this.controls.global.safeAreaH.value = String(Math.round(global.safeAreaH * 1000) / 10);

      for (const config of TEXT_SECTIONS) {
        const style = this.effectiveText(config.key);
        const controls = this.controls[config.key];
        controls.color.value = style.color;
        controls.fontFamily.value = FONTS.includes(style.fontFamily) ? style.fontFamily : 'Arial';
        if (controls.sizeEm) controls.sizeEm.value = style.sizeEm || '';
        if (controls.letterSpacing) controls.letterSpacing.value = String(style.letterSpacing || 0);
        if (controls.bold) controls.bold.classList.toggle('active', !!style.bold);
        if (controls.italic) controls.italic.classList.toggle('active', !!style.italic);
        if (controls.textAlign) this.setSegment(controls.textAlign, style.textAlign || 'center');
        if (controls.shadowColor) controls.shadowColor.value = style.shadowColor;
        for (const key of ['shadowBlur', 'shadowX', 'shadowY']) if (controls[key]) this.setRange(controls[key], style[key] || 0);
        if (controls.strokeColor) controls.strokeColor.value = style.strokeColor;
        if (controls.strokeWidth) controls.strokeWidth.value = String(style.strokeWidth || 0);
        if (controls.songInline) controls.songInline.classList.toggle('active', !!global.songInline);
      }

      this.setStatus(this.baselineAvailable
        ? 'Using Worship’s current styles as the baseline. Changes below affect only this source.'
        : 'Worship defaults are unavailable right now. Source overrides still work and stay local to this source.');
    }

    readText(config) {
      const current = this.effectiveText(config.key);
      const c = this.controls[config.key];
      return {
        ...current,
        color: c.color.value || current.color,
        fontFamily: c.fontFamily.value || current.fontFamily,
        sizeEm: c.sizeEm ? c.sizeEm.value : '',
        bold: c.bold ? c.bold.classList.contains('active') : current.bold,
        italic: c.italic ? c.italic.classList.contains('active') : current.italic,
        textAlign: c.textAlign ? this.getSegment(c.textAlign, 'center') : current.textAlign,
        letterSpacing: c.letterSpacing ? Number.parseFloat(c.letterSpacing.value) || 0 : current.letterSpacing,
        shadowColor: c.shadowColor ? c.shadowColor.value : current.shadowColor,
        shadowBlur: c.shadowBlur ? Number.parseFloat(c.shadowBlur.value) || 0 : current.shadowBlur,
        shadowX: c.shadowX ? Number.parseFloat(c.shadowX.value) || 0 : current.shadowX,
        shadowY: c.shadowY ? Number.parseFloat(c.shadowY.value) || 0 : current.shadowY,
        strokeColor: c.strokeColor ? c.strokeColor.value : current.strokeColor,
        strokeWidth: c.strokeWidth ? Number.parseFloat(c.strokeWidth.value) || 0 : current.strokeWidth
      };
    }

    readGlobal() {
      const c = this.controls.global;
      const clampPercent = (input, fallback) => {
        const value = Number.parseFloat(input.value);
        return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 : fallback;
      };
      return {
        overlayOpacity: Math.max(0, Math.min(100, Number.parseFloat(c.overlayOpacity.value) || 0)) / 100,
        bgBlur: Math.max(0, Math.min(20, Number.parseFloat(c.bgBlur.value) || 0)),
        lineHeight: Number.parseFloat(c.lineHeight.value) || 1.2,
        verticalPosition: this.getSegment(c.verticalPosition, 'center'),
        safeAreaX: clampPercent(c.safeAreaX, 0.04),
        safeAreaY: clampPercent(c.safeAreaY, 0.04),
        safeAreaW: clampPercent(c.safeAreaW, 0.92),
        safeAreaH: clampPercent(c.safeAreaH, 0.92),
        songInline: !!this.controls.songText.songInline && this.controls.songText.songInline.classList.contains('active')
      };
    }

    buildTextCss(config, style) {
      const parts = [
        'color: ' + style.color + ';',
        'font-family: ' + style.fontFamily + ';'
      ];
      if (config.size && style.sizeEm) parts.push('font-size: ' + style.sizeEm + 'em;');
      if (config.bold) parts.push('font-weight: ' + (style.bold ? 'bold' : 'normal') + ';');
      if (config.italic) parts.push('font-style: ' + (style.italic ? 'italic' : 'normal') + ';');
      if (config.align) parts.push('text-align: ' + style.textAlign + ';');
      if (config.spacing) parts.push('letter-spacing: ' + (Number(style.letterSpacing) || 0) + ';');
      if (config.shadow) {
        parts.push('shadow-color: ' + style.shadowColor + ';');
        parts.push('shadow-blur: ' + (Number(style.shadowBlur) || 0) + ';');
        parts.push('shadow-x: ' + (Number(style.shadowX) || 0) + ';');
        parts.push('shadow-y: ' + (Number(style.shadowY) || 0) + ';');
      }
      if (config.outline) {
        parts.push('stroke-color: ' + style.strokeColor + ';');
        parts.push('stroke-width: ' + (Number(style.strokeWidth) || 0) + ';');
      }
      return parts.join(' ');
    }

    buildGlobalCss(style) {
      return [
        'overlay-opacity: ' + style.overlayOpacity + ';',
        'bg-blur: ' + style.bgBlur + ';',
        'line-height: ' + style.lineHeight + ';',
        'vertical-position: ' + style.verticalPosition + ';',
        'safe-area-x: ' + style.safeAreaX.toFixed(4) + ';',
        'safe-area-y: ' + style.safeAreaY.toFixed(4) + ';',
        'safe-area-w: ' + style.safeAreaW.toFixed(4) + ';',
        'safe-area-h: ' + style.safeAreaH.toFixed(4) + ';',
        'song-inline: ' + (style.songInline ? 1 : 0) + ';'
      ].join(' ');
    }

    applyText(config) {
      if (!this.layer) return;
      this.layer.sourceStyles = this.layer.sourceStyles || {};
      this.layer.sourceStyles[config.key] = this.buildTextCss(config, this.readText(config));
      this.onApply(this.layer);
      this.setStatus(config.title + ' override saved for this source.');
    }

    applyGlobal() {
      if (!this.layer) return;
      this.layer.sourceStyles = this.layer.sourceStyles || {};
      this.layer.sourceStyles.global = this.buildGlobalCss(this.readGlobal());
      this.onApply(this.layer);
      this.populateGlobalOnly();
      this.setStatus('Canvas and layout override saved for this source.');
    }

    populateGlobalOnly() {
      if (!this.layer) return;
      const global = this.effectiveGlobal();
      this.setRange(this.controls.global.overlayOpacity, Math.round(global.overlayOpacity * 100));
      this.setRange(this.controls.global.bgBlur, global.bgBlur);
      this.controls.global.lineHeight.value = String(global.lineHeight);
      this.setSegment(this.controls.global.verticalPosition, global.verticalPosition);
      this.controls.global.safeAreaX.value = String(Math.round(global.safeAreaX * 1000) / 10);
      this.controls.global.safeAreaY.value = String(Math.round(global.safeAreaY * 1000) / 10);
      this.controls.global.safeAreaW.value = String(Math.round(global.safeAreaW * 1000) / 10);
      this.controls.global.safeAreaH.value = String(Math.round(global.safeAreaH * 1000) / 10);
      if (this.controls.songText.songInline) this.controls.songText.songInline.classList.toggle('active', !!global.songInline);
    }

    resetSection(key) {
      if (!this.layer) return;
      this.layer.sourceStyles = this.layer.sourceStyles || {};
      delete this.layer.sourceStyles[key];
      this.onApply(this.layer);
      if (key === 'global') this.populateGlobalOnly();
      else {
        const config = TEXT_SECTIONS.find((item) => item.key === key);
        if (config) this.populateTextOnly(config);
      }
      this.setStatus('This section now follows Worship again.');
    }

    populateTextOnly(config) {
      const style = this.effectiveText(config.key);
      const c = this.controls[config.key];
      c.color.value = style.color;
      c.fontFamily.value = FONTS.includes(style.fontFamily) ? style.fontFamily : 'Arial';
      if (c.sizeEm) c.sizeEm.value = style.sizeEm || '';
      if (c.letterSpacing) c.letterSpacing.value = String(style.letterSpacing || 0);
      if (c.bold) c.bold.classList.toggle('active', !!style.bold);
      if (c.italic) c.italic.classList.toggle('active', !!style.italic);
      if (c.textAlign) this.setSegment(c.textAlign, style.textAlign || 'center');
      if (c.shadowColor) c.shadowColor.value = style.shadowColor;
      for (const key of ['shadowBlur', 'shadowX', 'shadowY']) if (c[key]) this.setRange(c[key], style[key] || 0);
      if (c.strokeColor) c.strokeColor.value = style.strokeColor;
      if (c.strokeWidth) c.strokeWidth.value = String(style.strokeWidth || 0);
    }
  }

  window.SourceStyleEditor = {
    create(container, onApply) {
      return new SourceStyleEditor(container, onApply);
    }
  };
})();
