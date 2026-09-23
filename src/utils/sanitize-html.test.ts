import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml } from './sanitize-html.ts';

describe('sanitizeHtml', () => {
  it('drops script/style elements with their content', () => {
    const out = sanitizeHtml('<p>Hi</p><script>alert(1)</script><style>.x{}</style>');
    assert.ok(!out.includes('script') && !out.includes('alert'));
    assert.ok(out.includes('<p>Hi</p>'));
  });

  it('strips event-handler attributes', () => {
    const out = sanitizeHtml('<p onclick="evil()" ONMOUSEOVER=\'x\'>Hi</p>');
    assert.ok(!out.includes('onclick') && !out.includes('onmouseover'));
    assert.ok(out.includes('Hi'));
  });

  it('neutralizes javascript: and vbscript: URLs', () => {
    const out = sanitizeHtml('<a href="javascript:evil()">x</a><img src="vbscript:y">');
    assert.ok(!out.includes('javascript') && !out.includes('vbscript'));
  });

  it('drops non-image data: URLs but keeps data:image', () => {
    const out = sanitizeHtml('<a href="data:text/html,evil">x</a><img src="data:image/png;base64,AAA">');
    assert.ok(!out.includes('data:text/html'));
    assert.ok(out.includes('data:image/png'));
  });

  it('preserves cid: references for inline images', () => {
    const out = sanitizeHtml('<img src="cid:pic1@x">');
    assert.ok(out.includes('cid:pic1@x'));
  });

  it('drops iframes, forms, and inputs entirely', () => {
    const out = sanitizeHtml('<iframe src="https://evil"></iframe><form><input type="text"></form><p>ok</p>');
    assert.ok(!out.includes('iframe') && !out.includes('<form') && !out.includes('<input'));
    assert.ok(out.includes('ok'));
  });

  it('returns empty for non-strings and caps length', () => {
    assert.equal(sanitizeHtml(null), '');
    assert.equal(sanitizeHtml(undefined), '');
    assert.ok(sanitizeHtml('x'.repeat(300_000)).length <= 200_000);
  });
});
