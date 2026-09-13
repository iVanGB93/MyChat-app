const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual component without loading the entire chat screen.
const screen = fs.readFileSync(path.join(__dirname, '../src/screens/chat/ChatRoomScreen.tsx'), 'utf8');
const component = screen.slice(screen.indexOf('function SyncingHeaderTitle('), screen.indexOf('\nfunction ChatHeaderIdentity('));
const compiled = ts.transpileModule(`${component}\nexports.render = SyncingHeaderTitle;`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const hooks = [];
  const pending = [];
  const loops = [];
  let cursor = 0;
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    interpolate(config) { return { value: this, config }; }
  }
  const sandbox = {
    exports: {},
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    View: 'View',
    styles: {},
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { deps, value: factory() };
      return hooks[index].value;
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(hooks[index]?.deps, deps)) pending.push(() => {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps, cleanup: effect() };
      });
    },
    Animated: {
      Value, Text: 'Animated.Text',
      timing: (value, config) => ({ value, config }),
      sequence: (steps) => steps,
      stagger: (_, steps) => steps,
      delay: () => null,
      loop: () => {
        const loop = { started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } };
        loops.push(loop);
        return loop;
      },
    },
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    loops,
    render(title, syncing = true) {
      cursor = 0;
      const tree = sandbox.exports.render({ title, syncing, color: '#fff' });
      pending.splice(0).forEach((effect) => effect());
      return tree.children[0].children[0];
    },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); },
  };
}

test('syncing header safely grows from a notification placeholder to a group name', () => {
  const f = fixture();
  f.render('Chat');
  const oldLoop = f.loops[0];
  const letters = f.render('Family group chat');
  assert.equal(letters.length, 17);
  assert.ok(oldLoop.stopped);
  assert.ok(f.loops.at(-1).started);
  assert.ok(letters.every((letter) => letter.props.style[1].opacity.value));
  f.render('Dad');
  f.render('');
  assert.ok(f.loops.every((loop) => loop.stopped));
  f.render('New group');
  f.unmount();
  assert.ok(f.loops.every((loop) => loop.stopped));
});

test('title updates while idle remain safe when syncing resumes', () => {
  const f = fixture();
  f.render('', false);
  f.render('A much longer group name', false);
  const letters = f.render('A much longer group name', true);
  assert.ok(letters.every((letter) => letter.props.style[1].opacity.value));
  f.render('A much longer group name', false);
  assert.ok(f.loops.every((loop) => loop.stopped));
});

test('header caps rendered characters without splitting emoji surrogate pairs', () => {
  const f = fixture();
  const letters = f.render('😀'.repeat(30));
  assert.equal(letters.length, 24);
  assert.ok(letters.every((letter) => letter.children[0] === '😀'));
});
