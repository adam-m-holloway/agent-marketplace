// Fuse.js options shared by the page (app.js) and the Node test (tests/build-site.test.mjs).
// Plain script, no modules: defines a global.
var FUSE_OPTIONS = {
  threshold: 0.4,
  ignoreLocation: true,
  includeScore: true,
  keys: [
    { name: 'name', weight: 3 },
    { name: 'tags', weight: 2 },
    { name: 'skills', weight: 1.5 },
    { name: 'description', weight: 1 },
  ],
};
