/**
 * Tests eligible File/Directory mock (Expo SDK 58 API):
 * - new File(dirBase, "name") / new File(dir, "name") / new File(uri)
 * - file.exists, file.uri, file.name, file.extension
 * - file.create(), file.delete(), file.copy(dest, { overwrite })
 * - new Directory(base, "name"), dir.exists, dir.create(), dir.delete(), dir.list()
 * - Paths.document / Paths.cache
 * Backed by one shared in-memory set of paths, so services can act on files.
 */

const state = { files: new Set(), dirs: new Set() };

function joinUris(...uris) {
  return uris
    .map((u) => (typeof u === 'string' ? u : u.uri))
    .filter((u) => u && typeof u === 'string')
    .map((u) => u.replace(/\/+$/, ''))
    .join('/');
}

function initMockState(initial = {}) {
  state.files = new Set(initial.files ?? []);
  state.dirs = new Set(initial.dirs ?? ['file:///mock-documents', 'file:///mock-cache']);
  return state;
}

function includeDirAncestors(dirUri) {
  // Ensure the parent chain registers as directories for list() to work.
  let current = dirUri;
  while (current && current !== 'file://') {
    state.dirs.add(current);
    const next = current.substring(0, current.lastIndexOf('/'));
    if (!next || next === current) break;
    current = next;
  }
}

function listDir(dirUri) {
  const prefix = dirUri.replace(/\/+$/, '') + '/';
  const children = [];
  for (const uri of state.files) {
    if (uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/')) {
      children.push(uri);
    }
  }
  return children.map((uri) => new MockFile(uri));
}

class MockFile {
  constructor(...uris) {
    this.uri = joinUris(...uris);
  }

  get exists() {
    return state.files.has(this.uri);
  }

  get name() {
    return this.uri.substring(this.uri.lastIndexOf('/') + 1);
  }

  get extension() {
    const name = this.name;
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot);
  }

  create() {
    includeDirAncestors(this.uri.substring(0, this.uri.lastIndexOf('/')));
    state.files.add(this.uri);
  }

  delete() {
    state.files.delete(this.uri);
  }

  async copy(destination, options = {}) {
    const dest = destination instanceof MockFile ? destination : new MockFile(destination);
    if (dest.exists && !options.overwrite) {
      throw new Error(`Destination already exists: ${dest.uri}`);
    }
    if (!this.exists) {
      throw new Error(`Source does not exist: ${this.uri}`);
    }
    includeDirAncestors(dest.uri.substring(0, dest.uri.lastIndexOf('/')));
    state.files.add(dest.uri);
    return dest;
  }

  // Legacy/native helpers used elsewhere in the test suite.
  async arrayBuffer() {
    return new ArrayBuffer(0);
  }

  async bytes() {
    return new Uint8Array(0);
  }

  async write(content) {
    if (!state.fileContents) state.fileContents = new Map();
    state.fileContents.set(this.uri, typeof content === 'string' ? content : String(content));
    includeDirAncestors(this.uri.substring(0, this.uri.lastIndexOf('/')));
    state.files.add(this.uri);
  }

  async text() {
    return state.fileContents?.get(this.uri) ?? '';
  }

  static async pickFileAsync() {
    if (state.mockPickedFile) {
      return { result: state.mockPickedFile, canceled: false };
    }
    return { result: null, canceled: true };
  }
}

class MockDirectory {
  constructor(...uris) {
    this.uri = joinUris(...uris).replace(/\/+$/, '');
  }

  get exists() {
    return state.dirs.has(this.uri);
  }

  get name() {
    return this.uri.substring(this.uri.lastIndexOf('/') + 1);
  }

  create(options = {}) {
    if (options.idempotent && this.exists) return;
    if (this.exists && !options.overwrite) {
      throw new Error(`Directory already exists: ${this.uri}`);
    }
    includeDirAncestors(this.uri);
  }

  delete() {
    state.dirs.delete(this.uri);
    const prefix = this.uri + '/';
    for (const uri of [...state.files]) {
      if (uri.startsWith(prefix)) state.files.delete(uri);
    }
  }

  list() {
    if (!this.exists) throw new Error(`Directory does not exist: ${this.uri}`);
    return listDir(this.uri);
  }
}

class MockPaths {
  static get document() {
    return new MockDirectory('file:///mock-documents');
  }

  static get cache() {
    return new MockDirectory('file:///mock-cache');
  }
}

module.exports = {
  File: MockFile,
  Directory: MockDirectory,
  Paths: MockPaths,
  documentDirectory: 'file:///mock-documents/',
  cacheDirectory: 'file:///mock-cache/',
  writeAsStringAsync: async (uri, content) => {
    const file = new MockFile(uri);
    await file.write(content);
  },
  readAsStringAsync: async (uri) => {
    const file = new MockFile(uri);
    return file.text();
  },
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: async () => ({
      granted: true,
      directoryUri: 'content://mock-folder',
    }),
    createFileAsync: async (parentUri, fileName) => `${parentUri}/${fileName}.json`,
  },
  __initMockState: initMockState,
  __setMockPickedFile: (file) => {
    state.mockPickedFile = file;
  },
};
