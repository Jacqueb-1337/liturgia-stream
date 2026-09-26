'use strict';

const fs = require('fs');
const path = require('path');

describe('Worship source style editor', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '..', 'sourceStyleEditor.js'), 'utf8');

  test('uses the expanded Worship-style editor instead of the legacy CSS textarea', () => {
    expect(html).toContain('id="worship-style-editor"');
    expect(html).toContain('src="sourceStyleEditor.js"');
    expect(html).not.toContain('id="worship-style-css"');
    expect(html).not.toContain('id="worship-style-target"');
  });

  test('mirrors Worship style sections for canvas, verses, and songs', () => {
    for (const section of [
      'Canvas & Layout',
      'Main Text',
      'Verse Number',
      'Inline Verse Numbers',
      'Verse Reference',
      'Song Text',
      'Song Reference'
    ]) {
      expect(editor).toContain(section);
    }
    expect(editor).toContain("this.tab = 'verses'");
    expect(editor).toContain("'songs'");
  });

  test('keeps overrides scoped to the selected Program source', () => {
    expect(editor).toContain('this.layer.sourceStyles');
    expect(editor).toContain('this.onApply(this.layer)');
    expect(editor).toContain('Use all Worship defaults');
  });
});
