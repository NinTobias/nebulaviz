const test = require('node:test'), assert = require('node:assert/strict');

const SAMPLE = `/* cyrillic */
@font-face {
  font-family: 'Oswald';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/oswald/v53/cyr.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin-ext */
@font-face {
  font-family: 'Oswald';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/oswald/v53/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Bebas Neue';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/bebasneue/v14/lat.woff2?x=1) format('woff2');
  unicode-range: U+0000-00FF;
}`;

test('font CSS parsing keeps latin subsets only and builds local CSS', async () => {
  const { parseFontCss, buildCss, fileNameFor } = await import('../tools/get-fonts.mjs');
  const faces = parseFontCss(SAMPLE);
  assert.deepEqual(faces.map(f => f.subset), ['latin-ext', 'latin']);
  assert.equal(fileNameFor(faces[1]), 'bebas-neue-lat.woff2');
  const css = buildCss(faces);
  assert.match(css, /font-family: 'Oswald'/);
  assert.match(css, /src: url\(oswald-ext\.woff2\) format\('woff2'\)/);
  assert.ok(!css.includes('gstatic'), 'no remote URLs are left in the generated CSS');
});
